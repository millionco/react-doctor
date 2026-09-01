use std::{
    cell::OnceCell as BrowserRenderOnceCell,
    path::{Path, PathBuf},
    sync::{Mutex as BrowserRenderMutex, OnceLock},
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, ExportDefaultDeclarationKind, Expression, ObjectPropertyKind, PropertyKey,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::SourceType;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const BROWSER_GLOBAL_NAMES: [&str; 6] = [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "navigator",
    "matchMedia",
];
const EMAIL_TEMPLATE_MODULES: [&str; 4] =
    ["@faire/mjml-react", "mjml-react", "mjml", "react-email"];
const EMAIL_TEMPLATE_MODULE_PREFIXES: [&str; 2] = ["@react-email/", "jsx-email"];
const BROWSER_RENDER_CROSS_FILE_DEPTH: usize = 4;
const BROWSER_RENDER_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;

#[derive(Clone, Copy)]
struct BrowserRenderImportedSnapshotCacheEntry {
    modified: Option<std::time::SystemTime>,
    size: u64,
    value: Option<bool>,
}

static BROWSER_RENDER_IMPORTED_SNAPSHOT_CACHE: OnceLock<
    BrowserRenderMutex<
        std::collections::HashMap<
            (PathBuf, String, String),
            BrowserRenderImportedSnapshotCacheEntry,
        >,
    >,
> = OnceLock::new();

#[derive(Debug, Default, Clone)]
pub struct NoUnguardedBrowserGlobalInRenderOrHookInit;

declare_oxc_lint!(
    /// Warns about browser globals read during server rendering.
    NoUnguardedBrowserGlobalInRenderOrHookInit,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Browser global read during server render.",
);

impl Rule for NoUnguardedBrowserGlobalInRenderOrHookInit {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_react_native_file_target(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if browser_render_is_email_template(ctx) {
            return;
        }
        let generated_image_opening_ids = BrowserRenderOnceCell::new();
        let module_exits_on_server = browser_render_module_exits_on_server(ctx);
        let client_only_targets = browser_render_client_only_dynamic_targets(ctx);
        let mut reported_spans = FxHashSet::default();

        for node in ctx.nodes().iter() {
            let candidate = match node.kind() {
                AstKind::IdentifierReference(identifier)
                    if BROWSER_GLOBAL_NAMES.contains(&identifier.name.as_str())
                        && ctx.is_reference_to_global_variable(identifier) =>
                {
                    Some((identifier.name.as_str(), node.span()))
                }
                AstKind::StaticMemberExpression(member)
                    if BROWSER_GLOBAL_NAMES.contains(&member.property.name.as_str())
                        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "globalThis"
                                && ctx.is_reference_to_global_variable(identifier)) =>
                {
                    Some((member.property.name.as_str(), node.span()))
                }
                _ => None,
            };
            let Some((global_name, diagnostic_span)) = candidate else {
                continue;
            };
            if !reported_spans.insert((diagnostic_span.start, diagnostic_span.end))
                || browser_render_is_typeof_probe(node, ctx)
            {
                continue;
            }
            let Some(owner) = find_render_phase_component_or_hook(node, ctx) else {
                continue;
            };
            if module_exits_on_server
                || client_only_targets.contains(&owner.id())
                || browser_render_is_generated_image_context(
                    node,
                    generated_image_opening_ids
                        .get_or_init(|| generated_image_jsx_opening_element_ids(ctx)),
                    ctx,
                )
                || browser_render_is_gated_by_initial_state(node, ctx)
                || browser_render_is_gated_by_server_snapshot(node, ctx)
                || browser_render_is_after_client_only_early_return(node, owner, ctx)
                || browser_render_is_after_server_snapshot_early_return(node, owner, ctx)
                || browser_render_is_inside_availability_guard(node, global_name, ctx)
                || browser_render_is_after_availability_early_exit(node, owner, global_name, ctx)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "`{global_name}` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot."
                ))
                .with_label(diagnostic_span),
            );
        }
    }
}

fn browser_render_is_email_template(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        let source = entry.module_request.name();
        EMAIL_TEMPLATE_MODULES.contains(&source)
            || EMAIL_TEMPLATE_MODULE_PREFIXES
                .iter()
                .any(|prefix| source.starts_with(prefix))
    })
}

fn browser_render_is_generated_image_context(
    node: &AstNode<'_>,
    generated_image_opening_ids: &std::collections::HashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    browser_render_is_generated_image_filename(ctx)
        || ctx.nodes().ancestors(node.id()).any(|ancestor| {
            matches!(ancestor.kind(), AstKind::JSXOpeningElement(_))
                && generated_image_opening_ids.contains(&ancestor.id())
                || matches!(ancestor.kind(), AstKind::JSXElement(element)
                    if generated_image_opening_ids.contains(&element.opening_element.node_id.get()))
        })
}

fn browser_render_is_generated_image_filename(ctx: &LintContext<'_>) -> bool {
    let file_name = ctx
        .file_path()
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs")
        && ["opengraph-image", "twitter-image", "icon", "apple-icon"]
            .iter()
            .any(|prefix| {
                stem.strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
            })
}

fn browser_render_is_typeof_probe<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    matches!(ctx.nodes().parent_kind(root.id()), AstKind::UnaryExpression(unary)
        if unary.operator == UnaryOperator::Typeof)
}

fn browser_render_module_exits_on_server(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::IfStatement(statement) = node.kind() else {
            return false;
        };
        if !matches!(ctx.nodes().parent_kind(node.id()), AstKind::Program(_)) {
            return false;
        }
        browser_render_read_availability(&statement.test, "window", false, ctx) == Some(true)
            && statement_always_exits(&statement.consequent)
            || browser_render_read_availability(&statement.test, "window", true, ctx) == Some(true)
                && statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| statement_always_exits(alternate))
    })
}

fn browser_render_client_only_dynamic_targets(ctx: &LintContext<'_>) -> FxHashSet<NodeId> {
    let mut targets = FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            continue;
        };
        let call = match &declaration.declaration {
            ExportDefaultDeclarationKind::CallExpression(call) => call,
            ExportDefaultDeclarationKind::Identifier(identifier) => {
                let Some(Expression::CallExpression(call)) =
                    browser_render_const_initializer(identifier, ctx)
                        .map(Expression::get_inner_expression)
                else {
                    continue;
                };
                call
            }
            _ => continue,
        };
        if call.arguments.len() < 2 {
            continue;
        }
        let Expression::Identifier(dynamic_identifier) = call.callee.get_inner_expression() else {
            continue;
        };
        let Some(dynamic_symbol_id) = ctx
            .scoping()
            .get_reference(dynamic_identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if !matches!(
            ctx.symbol_declaration(dynamic_symbol_id).kind(),
            AstKind::ImportDefaultSpecifier(_)
        ) {
            continue;
        }
        let Some(import_entry) = resolve_identifier_import(dynamic_identifier, ctx) else {
            continue;
        };
        if import_entry.module_request.name() != "next/dynamic"
            || !matches!(import_entry.import_name, ImportImportName::Default(_))
            || !browser_render_dynamic_disables_ssr(call)
        {
            continue;
        }
        let Some(loader) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        let loader_node = match loader {
            Expression::ArrowFunctionExpression(function) if function.params.items.is_empty() => {
                ctx.nodes().get_node(function.node_id.get())
            }
            Expression::FunctionExpression(function) if function.params.items.is_empty() => {
                ctx.nodes().get_node(function.node_id.get())
            }
            _ => continue,
        };
        let Some(Expression::Identifier(target_identifier)) =
            browser_render_single_return_expression(loader_node)
                .map(Expression::get_inner_expression)
        else {
            continue;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(target_identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
            || ctx.scoping().get_resolved_references(symbol_id).count() != 1
        {
            continue;
        }
        if let Some(target) = browser_render_function_for_symbol(symbol_id, ctx) {
            targets.insert(target.id());
        }
    }
    targets
}

fn browser_render_dynamic_disables_ssr(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(Expression::ObjectExpression(options)) = call
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let mut disabled = false;
    for property in &options.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => disabled = false,
            ObjectPropertyKind::ObjectProperty(property) => {
                let name = if property.computed {
                    match &property.key {
                        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
                        PropertyKey::TemplateLiteral(template)
                            if template.expressions.is_empty() =>
                        {
                            template.quasis.first().map(|quasi| {
                                quasi
                                    .value
                                    .cooked
                                    .as_ref()
                                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                            })
                        }
                        _ => None,
                    }
                } else {
                    match &property.key {
                        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
                        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
                        _ => None,
                    }
                };
                let Some(name) = name else {
                    if property.computed {
                        disabled = false;
                    }
                    continue;
                };
                if name != "ssr" {
                    continue;
                }
                disabled = matches!(property.value.get_inner_expression(), Expression::BooleanLiteral(literal) if !literal.value);
            }
        }
    }
    disabled
}

fn browser_render_function_for_symbol<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(ctx.nodes().get_node(function.node_id.get())),
        AstKind::VariableDeclarator(declarator) if matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                Expression::FunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn browser_render_is_inside_availability_guard<'a>(
    node: &AstNode<'a>,
    global_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !function_executes_during_render(ancestor, ctx)
        {
            return false;
        }
        let guarded = match ancestor.kind() {
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                (logical.operator == LogicalOperator::And
                    && browser_render_read_availability(&logical.left, global_name, true, ctx)
                        == Some(true))
                    || (logical.operator == LogicalOperator::Or
                        && browser_render_read_availability(&logical.left, global_name, false, ctx)
                            == Some(true))
            }
            AstKind::ConditionalExpression(conditional) => {
                conditional.consequent.span() == child_span
                    && browser_render_read_availability(&conditional.test, global_name, true, ctx)
                        == Some(true)
                    || conditional.alternate.span() == child_span
                        && browser_render_read_availability(
                            &conditional.test,
                            global_name,
                            false,
                            ctx,
                        ) == Some(true)
            }
            AstKind::IfStatement(statement) => {
                statement.consequent.span() == child_span
                    && browser_render_read_availability(&statement.test, global_name, true, ctx)
                        == Some(true)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child_span)
                        && browser_render_read_availability(
                            &statement.test,
                            global_name,
                            false,
                            ctx,
                        ) == Some(true)
            }
            _ => false,
        };
        if guarded {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn browser_render_is_after_availability_early_exit<'a>(
    node: &AstNode<'a>,
    owner: &AstNode<'a>,
    global_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    if enclosing_function.id() != owner.id()
        && !function_executes_during_render(enclosing_function, ctx)
    {
        return false;
    }
    browser_render_prior_if_statement(node, enclosing_function, ctx, |statement| {
        browser_render_read_availability(&statement.test, global_name, false, ctx) == Some(true)
            && statement_always_exits(&statement.consequent)
            || browser_render_read_availability(&statement.test, global_name, true, ctx)
                == Some(true)
                && statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| statement_always_exits(alternate))
    })
}

fn browser_render_read_availability<'a>(
    expression: &Expression<'a>,
    global_name: &str,
    predicate_result: bool,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    browser_render_read_availability_inner(
        expression,
        global_name,
        predicate_result,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn browser_render_read_availability_inner<'a>(
    expression: &Expression<'a>,
    global_name: &str,
    predicate_result: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            browser_render_read_availability_inner(
                &unary.argument,
                global_name,
                !predicate_result,
                ctx,
                visited_symbols,
            )
        }
        Expression::LogicalExpression(logical)
            if logical.operator == LogicalOperator::And && predicate_result
                || logical.operator == LogicalOperator::Or && !predicate_result =>
        {
            let left = browser_render_read_availability_inner(
                &logical.left,
                global_name,
                predicate_result,
                ctx,
                &mut visited_symbols.clone(),
            );
            let right = browser_render_read_availability_inner(
                &logical.right,
                global_name,
                predicate_result,
                ctx,
                &mut visited_symbols.clone(),
            );
            match (left, right) {
                (None, other) | (other, None) => other,
                (Some(left), Some(right)) if left == right => Some(left),
                _ => None,
            }
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            if let Some(initializer) = browser_render_const_initializer(identifier, ctx) {
                return browser_render_read_availability_inner(
                    initializer,
                    global_name,
                    predicate_result,
                    ctx,
                    visited_symbols,
                );
            }
            None
        }
        Expression::CallExpression(call) if call.arguments.is_empty() => {
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let returned = browser_render_zero_argument_function_result(symbol_id, ctx)?;
            browser_render_read_availability_inner(
                returned,
                global_name,
                predicate_result,
                ctx,
                visited_symbols,
            )
        }
        Expression::BinaryExpression(binary) => {
            browser_render_literal_availability(binary, global_name, predicate_result, ctx)
        }
        _ => None,
    }
}

fn browser_render_literal_availability<'a>(
    binary: &oxc_ast::ast::BinaryExpression<'a>,
    global_name: &str,
    predicate_result: bool,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let left_guard = browser_render_typeof_global_name(&binary.left, ctx);
    let right_guard = browser_render_typeof_global_name(&binary.right, ctx);
    let left_string = browser_render_static_string(&binary.left);
    let right_string = browser_render_static_string(&binary.right);
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

fn browser_render_typeof_global_name<'expression, 'ast>(
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
            if BROWSER_GLOBAL_NAMES.contains(&identifier.name.as_str())
                && ctx.is_reference_to_global_variable(identifier) =>
        {
            Some(identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member)
            if BROWSER_GLOBAL_NAMES.contains(&member.property.name.as_str())
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "globalThis"
                        && ctx.is_reference_to_global_variable(identifier)) =>
        {
            Some(member.property.name.as_str())
        }
        _ => None,
    }
}

fn browser_render_static_string<'expression>(
    expression: &'expression Expression<'_>,
) -> Option<&'expression str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn browser_render_const_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
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
    matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        .then(|| declarator.init.as_ref())
        .flatten()
}

fn browser_render_zero_argument_function_result<'a>(
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
    let function = browser_render_function_for_symbol(symbol_id, ctx)?;
    match function.kind() {
        AstKind::Function(function)
            if function.r#async || function.generator || !function.params.items.is_empty() =>
        {
            return None;
        }
        AstKind::ArrowFunctionExpression(function)
            if function.r#async || !function.params.items.is_empty() =>
        {
            return None;
        }
        _ => {}
    }
    browser_render_single_return_expression(function)
}

fn browser_render_single_return_expression<'a>(
    function: &AstNode<'a>,
) -> Option<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(arrow) = function.kind()
        && let Some(expression) = arrow.get_expression()
    {
        return Some(expression);
    }
    let body = match function.kind() {
        AstKind::Function(function) => function.body.as_deref()?,
        AstKind::ArrowFunctionExpression(function) => function.get_function_body()?,
        _ => return None,
    };
    if !body.directives.is_empty() || body.statements.len() != 1 {
        return None;
    }
    let Statement::ReturnStatement(statement) = &body.statements[0] else {
        return None;
    };
    statement.argument.as_ref()
}

fn browser_render_exact_function_result<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(arrow) = function.kind()
        && let Some(expression) = arrow.get_expression()
    {
        return Some(expression);
    }
    let body = match function.kind() {
        AstKind::Function(function) => function.body.as_deref()?,
        AstKind::ArrowFunctionExpression(function) => function.get_function_body()?,
        _ => return None,
    };
    let Statement::ReturnStatement(last_statement) = body.statements.last()? else {
        return None;
    };
    let return_count = ctx
        .nodes()
        .iter()
        .filter(|node| {
            body.span.contains_inclusive(node.span())
                && matches!(node.kind(), AstKind::ReturnStatement(_))
                && crate::ast_util::get_enclosing_function(node, ctx)
                    .is_some_and(|owner| owner.id() == function.id())
        })
        .count();
    (return_count == 1)
        .then(|| last_statement.argument.as_ref())
        .flatten()
}

fn browser_render_is_gated_by_initial_state<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    browser_render_is_gated_by_boolean(node, ctx, browser_render_read_initial_state_boolean)
}

fn browser_render_is_gated_by_boolean<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    read: fn(&Expression<'a>, &LintContext<'a>) -> Option<bool>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let gated = match ancestor.kind() {
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                let value = read(&logical.left, ctx);
                logical.operator == LogicalOperator::And && value == Some(false)
                    || logical.operator == LogicalOperator::Or && value == Some(true)
            }
            AstKind::ConditionalExpression(conditional) => {
                let value = read(&conditional.test, ctx);
                conditional.consequent.span() == child_span && value == Some(false)
                    || conditional.alternate.span() == child_span && value == Some(true)
            }
            AstKind::IfStatement(statement) => {
                let value = read(&statement.test, ctx);
                statement.consequent.span() == child_span && value == Some(false)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child_span)
                        && value == Some(true)
            }
            _ => false,
        };
        if gated {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn browser_render_read_initial_state_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    browser_render_read_initial_state_boolean_inner(
        expression,
        ctx,
        &mut FxHashSet::default(),
        false,
    )
}

fn browser_render_read_initial_state_boolean_inner<'a>(
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
                return None;
            };
            if let BindingPattern::ArrayPattern(pattern) = &declarator.id
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
                let Some(initializer) = call.arguments.first() else {
                    return Some(false);
                };
                return browser_render_read_initial_state_boolean_inner(
                    initializer.as_expression()?,
                    ctx,
                    visited_symbols,
                    true,
                );
            }
            if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || !matches!(&declarator.id, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
            {
                return None;
            }
            browser_render_read_initial_state_boolean_inner(
                declarator.init.as_ref()?,
                ctx,
                visited_symbols,
                allow_lazy_initializer,
            )
        }
        Expression::ArrowFunctionExpression(function)
            if allow_lazy_initializer && !function.r#async =>
        {
            let returned = function.get_expression().or_else(|| {
                let body = function.get_function_body()?;
                if !body.directives.is_empty() || body.statements.len() != 1 {
                    return None;
                }
                let Statement::ReturnStatement(statement) = &body.statements[0] else {
                    return None;
                };
                statement.argument.as_ref()
            })?;
            browser_render_read_initial_state_boolean_inner(returned, ctx, visited_symbols, false)
        }
        Expression::FunctionExpression(function)
            if allow_lazy_initializer && !function.r#async && !function.generator =>
        {
            let body = function.body.as_deref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            browser_render_read_initial_state_boolean_inner(
                statement.argument.as_ref()?,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            browser_render_read_initial_state_boolean_inner(
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
            let left = browser_render_read_initial_state_boolean_inner(
                &logical.left,
                ctx,
                &mut visited_symbols.clone(),
                false,
            );
            let right = browser_render_read_initial_state_boolean_inner(
                &logical.right,
                ctx,
                &mut visited_symbols.clone(),
                false,
            );
            match logical.operator {
                LogicalOperator::And if left == Some(false) || right == Some(false) => Some(false),
                LogicalOperator::And if left == Some(true) && right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(true) || right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(false) && right == Some(false) => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

fn browser_render_is_after_client_only_early_return<'a>(
    node: &AstNode<'a>,
    owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let statements = match owner.kind() {
        AstKind::Function(function) => function.body.as_deref().map(|body| &body.statements),
        AstKind::ArrowFunctionExpression(function) => {
            function.get_function_body().map(|body| &body.statements)
        }
        _ => None,
    };
    let Some(statements) = statements else {
        return false;
    };
    statements
        .iter()
        .take_while(|statement| statement.span().end <= node.span().start)
        .any(|statement| {
            let Statement::IfStatement(statement) = statement else {
                return false;
            };
            let value = browser_render_read_initial_state_boolean(&statement.test, ctx);
            value == Some(true) && statement_always_exits(&statement.consequent)
                || value == Some(false)
                    && statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| statement_always_exits(alternate))
        })
}

fn browser_render_prior_if_statement<'a>(
    node: &AstNode<'a>,
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    mut matches_guard: impl FnMut(&oxc_ast::ast::IfStatement<'a>) -> bool,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function.id() {
            let statements = match function.kind() {
                AstKind::Function(function) => {
                    function.body.as_deref().map(|body| &body.statements)
                }
                AstKind::ArrowFunctionExpression(function) => {
                    function.get_function_body().map(|body| &body.statements)
                }
                _ => None,
            };
            if let Some(statements) = statements
                && statements.iter().take_while(|statement| statement.span().end <= node.span().start).any(|statement| {
                    matches!(statement, Statement::IfStatement(statement) if matches_guard(statement))
                })
            {
                return true;
            }
            return false;
        }
        if let AstKind::BlockStatement(block) = ancestor.kind()
            && block.body.iter().take_while(|statement| statement.span().end <= child_span.start).any(|statement| {
                matches!(statement, Statement::IfStatement(statement) if matches_guard(statement))
            })
        {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn browser_render_is_gated_by_server_snapshot<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    browser_render_is_gated_by_boolean(node, ctx, browser_render_read_server_snapshot_boolean)
}

fn browser_render_is_after_server_snapshot_early_return<'a>(
    node: &AstNode<'a>,
    owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    if enclosing_function.id() != owner.id()
        && !function_executes_during_render(enclosing_function, ctx)
    {
        return false;
    }
    browser_render_prior_if_statement(node, enclosing_function, ctx, |statement| {
        let value = browser_render_read_server_snapshot_boolean(&statement.test, ctx);
        value == Some(true) && statement_always_exits(&statement.consequent)
            || value == Some(false)
                && statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| statement_always_exits(alternate))
    })
}

#[derive(Clone, Copy)]
struct BrowserRenderServerSnapshot {
    has_external_store_origin: bool,
    value: bool,
}

fn browser_render_read_server_snapshot_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let result = browser_render_read_server_snapshot_inner(
        expression,
        ctx,
        &mut FxHashSet::default(),
        &mut FxHashSet::default(),
    )?;
    result.has_external_store_origin.then_some(result.value)
}

fn browser_render_read_server_snapshot_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<BrowserRenderServerSnapshot> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(BrowserRenderServerSnapshot {
            has_external_store_origin: false,
            value: literal.value,
        }),
        Expression::Identifier(identifier) => {
            let initializer = browser_render_const_initializer(identifier, ctx)?;
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            browser_render_read_server_snapshot_inner(
                initializer,
                ctx,
                visited_symbols,
                visited_functions,
            )
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            browser_render_read_server_snapshot_inner(
                &unary.argument,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .map(|result| BrowserRenderServerSnapshot {
                has_external_store_origin: result.has_external_store_origin,
                value: !result.value,
            })
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let left = browser_render_read_server_snapshot_inner(
                &logical.left,
                ctx,
                &mut visited_symbols.clone(),
                &mut visited_functions.clone(),
            );
            if let Some(left) = left
                && (logical.operator == LogicalOperator::And && !left.value
                    || logical.operator == LogicalOperator::Or && left.value)
            {
                return Some(left);
            }
            let right = browser_render_read_server_snapshot_inner(
                &logical.right,
                ctx,
                &mut visited_symbols.clone(),
                &mut visited_functions.clone(),
            );
            if let Some(right) = right
                && (logical.operator == LogicalOperator::And && !right.value
                    || logical.operator == LogicalOperator::Or && right.value)
            {
                return Some(right);
            }
            let (Some(left), Some(right)) = (left, right) else {
                return None;
            };
            Some(BrowserRenderServerSnapshot {
                has_external_store_origin: left.has_external_store_origin
                    || right.has_external_store_origin,
                value: right.value,
            })
        }
        Expression::CallExpression(call) => {
            if is_react_api_call(call, "useSyncExternalStore", ctx) {
                let server_snapshot = call
                    .arguments
                    .get(2)
                    .and_then(oxc_ast::ast::Argument::as_expression)?;
                let value = browser_render_read_literal_callback(server_snapshot, ctx)?;
                return Some(BrowserRenderServerSnapshot {
                    has_external_store_origin: true,
                    value,
                });
            }
            if !call.arguments.is_empty() {
                return None;
            }
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return None;
            };
            if browser_render_identifier_alias_chain_is_immutable(identifier, ctx, true)
                && let Some(import_entry) = resolve_identifier_import(identifier, ctx)
            {
                let exported_name = match &import_entry.import_name {
                    ImportImportName::Name(name) => name.name(),
                    ImportImportName::Default(_) => "default",
                    ImportImportName::NamespaceObject => return None,
                };
                let fallback_hook_name = if exported_name == "default" {
                    identifier.name.as_str()
                } else {
                    exported_name
                };
                let file_path = browser_render_resolve_first_party_module_path(
                    ctx.file_path(),
                    import_entry.module_request.name(),
                )?;
                return browser_render_foreign_export_snapshot(
                    &file_path,
                    exported_name,
                    fallback_hook_name,
                    0,
                    &mut FxHashSet::default(),
                )
                .map(|value| BrowserRenderServerSnapshot {
                    has_external_store_origin: true,
                    value,
                });
            }
            if !crate::utils::is_react_hook_name(identifier.name.as_str()) {
                return None;
            }
            if !browser_render_identifier_alias_chain_is_immutable(identifier, ctx, false) {
                return None;
            }
            let symbol_id = resolve_const_identifier_alias(identifier, ctx)?;
            let function = browser_render_function_for_symbol(symbol_id, ctx)?;
            if !visited_functions.insert(function.id()) {
                return None;
            }
            let result = browser_render_zero_argument_function_result(symbol_id, ctx)?;
            browser_render_read_server_snapshot_inner(
                result,
                ctx,
                visited_symbols,
                visited_functions,
            )
        }
        _ => None,
    }
}

fn browser_render_identifier_alias_chain_is_immutable<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    allow_import_terminal: bool,
) -> bool {
    let Some(mut symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let mut visited_symbols = FxHashSet::default();
    loop {
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        if ctx.module_record().import_entries.iter().any(|entry| {
            !entry.is_type
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
        }) {
            return allow_import_terminal;
        }
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(_) => return true,
            AstKind::VariableDeclarator(declarator)
                if matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                    && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
            {
                let Some(initializer) = declarator.init.as_ref() else {
                    return false;
                };
                let Expression::Identifier(next_identifier) = initializer.get_inner_expression()
                else {
                    return true;
                };
                let Some(next_symbol_id) = ctx
                    .scoping()
                    .get_reference(next_identifier.reference_id())
                    .symbol_id()
                else {
                    return false;
                };
                symbol_id = next_symbol_id;
            }
            _ => return false,
        }
    }
}

fn browser_render_read_literal_callback<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let function = match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            ctx.nodes().get_node(function.node_id.get())
        }
        Expression::FunctionExpression(function) => ctx.nodes().get_node(function.node_id.get()),
        Expression::Identifier(identifier) => {
            if !browser_render_identifier_alias_chain_is_immutable(identifier, ctx, false) {
                return None;
            }
            let symbol_id = resolve_const_identifier_alias(identifier, ctx)?;
            browser_render_function_for_symbol(symbol_id, ctx)?
        }
        _ => return None,
    };
    match function.kind() {
        AstKind::Function(function) if function.r#async || function.generator => return None,
        AstKind::ArrowFunctionExpression(function) if function.r#async => return None,
        _ => {}
    }
    let returned = browser_render_exact_function_result(function, ctx)?;
    browser_render_read_immutable_boolean(returned, ctx, &mut FxHashSet::default())
}

fn browser_render_read_immutable_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            browser_render_read_immutable_boolean(
                browser_render_const_initializer(identifier, ctx)?,
                ctx,
                visited_symbols,
            )
        }
        _ => None,
    }
}

fn browser_render_resolve_first_party_module_path(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
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

fn browser_render_foreign_export_snapshot(
    file_path: &Path,
    exported_name: &str,
    fallback_hook_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<bool> {
    if depth >= BROWSER_RENDER_CROSS_FILE_DEPTH {
        return None;
    }
    if browser_render_is_declaration_file(file_path) {
        return None;
    }
    let metadata = std::fs::metadata(file_path).ok()?;
    if !metadata.is_file() || metadata.len() > BROWSER_RENDER_CROSS_FILE_PARSE_MAX_BYTES {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.into());
    if !visited_paths.insert(canonical_path.clone()) {
        return None;
    }
    let cache = BROWSER_RENDER_IMPORTED_SNAPSHOT_CACHE.get_or_init(Default::default);
    let cache_key = (
        canonical_path,
        exported_name.to_string(),
        fallback_hook_name.to_string(),
    );
    let modified = metadata.modified().ok();
    if let Some(cached) = cache
        .lock()
        .ok()
        .and_then(|results| results.get(&cache_key).copied())
        .filter(|cached| cached.modified == modified && cached.size == metadata.len())
    {
        return cached.value;
    }
    let result = browser_render_analyze_foreign_export(
        file_path,
        exported_name,
        fallback_hook_name,
        depth,
        visited_paths,
    );
    if let Ok(mut results) = cache.lock() {
        results.insert(
            cache_key,
            BrowserRenderImportedSnapshotCacheEntry {
                modified,
                size: metadata.len(),
                value: result,
            },
        );
    }
    result
}

fn browser_render_is_declaration_file(file_path: &Path) -> bool {
    let filename = file_path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    filename.ends_with(".d.ts") || filename.ends_with(".d.mts") || filename.ends_with(".d.cts")
}

fn browser_render_analyze_foreign_export(
    file_path: &Path,
    exported_name: &str,
    fallback_hook_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<bool> {
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = SourceType::from_path(file_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_id) =
        browser_render_foreign_exported_function_id(exported_name, &semantic, &module_record)
    {
        let function = semantic.nodes().get_node(function_id);
        let display_name =
            browser_render_foreign_function_name(function, &semantic).unwrap_or(fallback_hook_name);
        if !crate::utils::is_react_hook_name(display_name) {
            return None;
        }
        if !browser_render_foreign_function_has_no_parameters(function) {
            return None;
        }
        let result = browser_render_foreign_exact_function_result(function, &semantic)?;
        let snapshot = browser_render_foreign_read_snapshot(
            result,
            file_path,
            &semantic,
            &module_record,
            depth,
            visited_paths,
            &mut FxHashSet::default(),
            &mut FxHashSet::default(),
        )?;
        return snapshot.has_external_store_origin.then_some(snapshot.value);
    }
    if browser_render_foreign_has_local_export(exported_name, &module_record) {
        return None;
    }
    if let Some((module_source, imported_name)) =
        browser_render_foreign_reexport_target(exported_name, &module_record)
    {
        return browser_render_resolve_first_party_module_path(file_path, module_source).and_then(
            |reexported_path| {
                browser_render_foreign_export_snapshot(
                    &reexported_path,
                    imported_name,
                    fallback_hook_name,
                    depth + 1,
                    &mut visited_paths.clone(),
                )
            },
        );
    }

    let mut unique_export_all_result = None;
    for statement in &program.body {
        let Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(reexported_path) = browser_render_resolve_first_party_module_path(
            file_path,
            declaration.source.value.as_str(),
        ) else {
            continue;
        };
        let Some(result) = browser_render_foreign_export_snapshot(
            &reexported_path,
            exported_name,
            fallback_hook_name,
            depth + 1,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if unique_export_all_result.is_some() {
            return None;
        }
        unique_export_all_result = Some(result);
    }
    unique_export_all_result
}

fn browser_render_foreign_has_local_export(
    exported_name: &str,
    module_record: &ModuleRecord,
) -> bool {
    module_record
        .local_export_entries
        .iter()
        .any(|entry| match &entry.export_name {
            ExportExportName::Name(name) => name.name() == exported_name,
            ExportExportName::Default(_) => exported_name == "default",
            ExportExportName::Null => false,
        })
}

fn browser_render_foreign_exported_function_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        let matches_export = match &entry.export_name {
            ExportExportName::Name(name) => name.name() == exported_name,
            ExportExportName::Default(_) => exported_name == "default",
            ExportExportName::Null => false,
        };
        matches_export.then(|| entry.local_name.name()).flatten()
    }) && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
        && !semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        let declaration = semantic.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                return Some(declaration.id());
            }
            AstKind::VariableDeclarator(declarator) if matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) =>
            {
                return match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    _ => None,
                };
            }
            _ => {}
        }
    }
    if exported_name != "default" {
        return None;
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                Some(function.node_id.get())
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                Some(function.node_id.get())
            }
            _ => None,
        }
    })
}

fn browser_render_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let candidate_export = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if candidate_export != exported_name {
                return None;
            }
            let module_source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((module_source, imported_name))
        })
}

fn browser_render_foreign_function_has_no_parameters(function: &AstNode<'_>) -> bool {
    match function.kind() {
        AstKind::Function(function) => {
            !function.r#async && !function.generator && function.params.items.is_empty()
        }
        AstKind::ArrowFunctionExpression(function) => {
            !function.r#async && function.params.items.is_empty()
        }
        _ => false,
    }
}

fn browser_render_foreign_function_name<'a>(
    function: &AstNode<'a>,
    semantic: &Semantic<'a>,
) -> Option<&'a str> {
    if let AstKind::Function(function) = function.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.name.as_str());
    }
    semantic
        .nodes()
        .ancestors(function.id())
        .skip(1)
        .find_map(|ancestor| {
            let AstKind::VariableDeclarator(declarator) = ancestor.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.name.as_str())
        })
}

fn browser_render_foreign_exact_function_result<'a>(
    function: &AstNode<'a>,
    semantic: &Semantic<'a>,
) -> Option<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(arrow) = function.kind()
        && let Some(expression) = arrow.get_expression()
    {
        return Some(expression);
    }
    let body = match function.kind() {
        AstKind::Function(function) => function.body.as_deref()?,
        AstKind::ArrowFunctionExpression(function) => function.get_function_body()?,
        _ => return None,
    };
    let Statement::ReturnStatement(last_statement) = body.statements.last()? else {
        return None;
    };
    let return_count = semantic
        .nodes()
        .iter()
        .filter(|node| {
            body.span.contains_inclusive(node.span())
                && matches!(node.kind(), AstKind::ReturnStatement(_))
                && browser_render_foreign_enclosing_function_id(node.id(), semantic)
                    == Some(function.id())
        })
        .count();
    (return_count == 1)
        .then(|| last_statement.argument.as_ref())
        .flatten()
}

fn browser_render_foreign_enclosing_function_id(
    node_id: NodeId,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
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

#[allow(clippy::too_many_arguments)]
fn browser_render_foreign_read_snapshot<'a>(
    expression: &Expression<'a>,
    file_path: &Path,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<BrowserRenderServerSnapshot> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(BrowserRenderServerSnapshot {
            has_external_store_origin: false,
            value: literal.value,
        }),
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let initializer = browser_render_foreign_const_initializer(symbol_id, semantic)?;
            browser_render_foreign_read_snapshot(
                initializer,
                file_path,
                semantic,
                module_record,
                depth,
                visited_paths,
                visited_symbols,
                visited_functions,
            )
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            browser_render_foreign_read_snapshot(
                &unary.argument,
                file_path,
                semantic,
                module_record,
                depth,
                visited_paths,
                visited_symbols,
                visited_functions,
            )
            .map(|result| BrowserRenderServerSnapshot {
                has_external_store_origin: result.has_external_store_origin,
                value: !result.value,
            })
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let left = browser_render_foreign_read_snapshot(
                &logical.left,
                file_path,
                semantic,
                module_record,
                depth,
                &mut visited_paths.clone(),
                &mut visited_symbols.clone(),
                &mut visited_functions.clone(),
            );
            if let Some(left) = left
                && (logical.operator == LogicalOperator::And && !left.value
                    || logical.operator == LogicalOperator::Or && left.value)
            {
                return Some(left);
            }
            let right = browser_render_foreign_read_snapshot(
                &logical.right,
                file_path,
                semantic,
                module_record,
                depth,
                &mut visited_paths.clone(),
                &mut visited_symbols.clone(),
                &mut visited_functions.clone(),
            );
            if let Some(right) = right
                && (logical.operator == LogicalOperator::And && !right.value
                    || logical.operator == LogicalOperator::Or && right.value)
            {
                return Some(right);
            }
            let (Some(left), Some(right)) = (left, right) else {
                return None;
            };
            Some(BrowserRenderServerSnapshot {
                has_external_store_origin: left.has_external_store_origin
                    || right.has_external_store_origin,
                value: right.value,
            })
        }
        Expression::CallExpression(call) => {
            if browser_render_foreign_is_react_api_call(
                call,
                "useSyncExternalStore",
                semantic,
                module_record,
            ) {
                let callback = call
                    .arguments
                    .get(2)
                    .and_then(oxc_ast::ast::Argument::as_expression)?;
                let value = browser_render_foreign_read_literal_callback(
                    callback,
                    semantic,
                    module_record,
                    &mut FxHashSet::default(),
                )?;
                return Some(BrowserRenderServerSnapshot {
                    has_external_store_origin: true,
                    value,
                });
            }
            if !call.arguments.is_empty() {
                return None;
            }
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return None;
            };
            if let Some((module_source, exported_name)) =
                browser_render_foreign_import_binding(identifier, semantic, module_record)
                && let Some(imported_path) =
                    browser_render_resolve_first_party_module_path(file_path, module_source)
            {
                let fallback_hook_name = if exported_name == "default" {
                    identifier.name.as_str()
                } else {
                    exported_name
                };
                return browser_render_foreign_export_snapshot(
                    &imported_path,
                    exported_name,
                    fallback_hook_name,
                    depth + 1,
                    &mut visited_paths.clone(),
                )
                .map(|value| BrowserRenderServerSnapshot {
                    has_external_store_origin: true,
                    value,
                });
            }
            if !crate::utils::is_react_hook_name(identifier.name.as_str()) {
                return None;
            }
            if !browser_render_foreign_identifier_alias_chain_is_immutable(
                identifier,
                semantic,
                module_record,
                false,
            ) {
                return None;
            }
            let symbol_id = browser_render_foreign_resolve_const_alias(identifier, semantic)?;
            let function_id = browser_render_foreign_function_for_symbol(symbol_id, semantic)?;
            if !visited_functions.insert(function_id) {
                return None;
            }
            let function = semantic.nodes().get_node(function_id);
            if !browser_render_foreign_function_has_no_parameters(function) {
                return None;
            }
            let result = browser_render_foreign_exact_function_result(function, semantic)?;
            browser_render_foreign_read_snapshot(
                result,
                file_path,
                semantic,
                module_record,
                depth,
                visited_paths,
                visited_symbols,
                visited_functions,
            )
        }
        _ => None,
    }
}

fn browser_render_foreign_const_initializer<'a>(
    symbol_id: SymbolId,
    semantic: &Semantic<'a>,
) -> Option<&'a Expression<'a>> {
    if semantic
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        .then(|| declarator.init.as_ref())
        .flatten()
}

fn browser_render_foreign_resolve_const_alias(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
) -> Option<SymbolId> {
    let mut symbol_id = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited = FxHashSet::default();
    loop {
        if !visited.insert(symbol_id) {
            return None;
        }
        let declaration = semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        if !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(Expression::Identifier(next)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return Some(symbol_id);
        };
        symbol_id = semantic
            .scoping()
            .get_reference(next.reference_id())
            .symbol_id()?;
    }
}

fn browser_render_foreign_identifier_alias_chain_is_immutable(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    allow_import_terminal: bool,
) -> bool {
    let Some(mut symbol_id) = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let mut visited_symbols = FxHashSet::default();
    loop {
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        if module_record.import_entries.iter().any(|entry| {
            !entry.is_type
                && semantic
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
        }) {
            return allow_import_terminal;
        }
        if semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        let declaration = semantic.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(_) => return true,
            AstKind::VariableDeclarator(declarator)
                if matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                    && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
            {
                let Some(initializer) = declarator.init.as_ref() else {
                    return false;
                };
                let Expression::Identifier(next_identifier) = initializer.get_inner_expression()
                else {
                    return true;
                };
                let Some(next_symbol_id) = semantic
                    .scoping()
                    .get_reference(next_identifier.reference_id())
                    .symbol_id()
                else {
                    return false;
                };
                symbol_id = next_symbol_id;
            }
            _ => return false,
        }
    }
}

fn browser_render_foreign_function_for_symbol(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) if matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn browser_render_foreign_read_literal_callback<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    let function_id = match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
        Expression::FunctionExpression(function) => function.node_id.get(),
        Expression::Identifier(identifier) => {
            if !browser_render_foreign_identifier_alias_chain_is_immutable(
                identifier,
                semantic,
                module_record,
                false,
            ) {
                return None;
            }
            let symbol_id = browser_render_foreign_resolve_const_alias(identifier, semantic)?;
            browser_render_foreign_function_for_symbol(symbol_id, semantic)?
        }
        _ => return None,
    };
    let function = semantic.nodes().get_node(function_id);
    match function.kind() {
        AstKind::Function(function) if function.r#async || function.generator => return None,
        AstKind::ArrowFunctionExpression(function) if function.r#async => return None,
        _ => {}
    }
    let returned = browser_render_foreign_exact_function_result(function, semantic)?;
    browser_render_foreign_read_immutable_boolean(returned, semantic, visited_symbols)
}

fn browser_render_foreign_read_immutable_boolean<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            browser_render_foreign_read_immutable_boolean(
                browser_render_foreign_const_initializer(symbol_id, semantic)?,
                semantic,
                visited_symbols,
            )
        }
        _ => None,
    }
}

fn browser_render_foreign_import_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    if !browser_render_foreign_identifier_alias_chain_is_immutable(
        identifier,
        semantic,
        module_record,
        true,
    ) {
        return None;
    }
    let symbol_id = browser_render_foreign_resolve_const_alias(identifier, semantic)?;
    let import_entry = module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })?;
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return None,
    };
    Some((import_entry.module_request.name(), exported_name))
}

fn browser_render_foreign_is_react_api_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    api_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            browser_render_foreign_resolve_const_alias(identifier, semantic).is_some_and(
                |symbol_id| {
                    browser_render_foreign_matching_react_import(
                        symbol_id,
                        semantic,
                        module_record,
                    )
                    .is_some_and(|entry| {
                        matches!(&entry.import_name, ImportImportName::Name(name) if name.name() == api_name)
                    })
                },
            ) || browser_render_foreign_is_destructured_react_api_binding(
                identifier,
                api_name,
                semantic,
                module_record,
            )
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            if member.static_property_name() != Some(api_name) {
                return false;
            }
            browser_render_foreign_is_react_namespace_receiver(
                member.object().get_inner_expression(),
                semantic,
                module_record,
            )
        }),
    }
}

fn browser_render_foreign_is_destructured_react_api_binding(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    api_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> bool {
    let Some(symbol_id) = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return false;
    }
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        !property.computed
            && property_key_matches_name(&property.key, api_name)
            && matches!(&property.value, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        browser_render_foreign_is_react_namespace_receiver(
            initializer.get_inner_expression(),
            semantic,
            module_record,
        )
    })
}

fn browser_render_foreign_is_react_namespace_receiver(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> bool {
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = browser_render_foreign_resolve_const_alias(identifier, semantic) else {
        return false;
    };
    browser_render_foreign_matching_react_import(symbol_id, semantic, module_record).is_some_and(
        |entry| {
            matches!(
                entry.import_name,
                ImportImportName::Default(_) | ImportImportName::NamespaceObject
            ) || matches!(&entry.import_name, ImportImportName::Name(name) if name.name() == "default")
        },
    )
}

fn browser_render_foreign_matching_react_import<'a>(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    module_record: &'a ModuleRecord,
) -> Option<&'a crate::module_record::ImportEntry> {
    module_record.import_entries.iter().find(|entry| {
        REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}
