use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ModuleExportName, ObjectPropertyKind, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const AUTH_CHECK_LOOKAHEAD_STATEMENTS: usize = 10;
const AUTH_FUNCTION_NAMES: [&str; 11] = [
    "auth",
    "getSession",
    "getServerSession",
    "getUser",
    "requireAuth",
    "checkAuth",
    "verifyAuth",
    "authenticate",
    "currentUser",
    "getAuth",
    "validateSession",
];
const MUTATION_METHOD_NAMES: [&str; 10] = [
    "create",
    "insert",
    "insertInto",
    "update",
    "upsert",
    "delete",
    "remove",
    "destroy",
    "set",
    "append",
];
const BILLABLE_LANGCHAIN_METHOD_NAMES: [&str; 5] =
    ["batch", "generate", "invoke", "stream", "streamEvents"];
const LANGCHAIN_CHAINING_METHOD_NAMES: [&str; 4] =
    ["bind", "pipe", "withConfig", "withStructuredOutput"];
const CREDENTIAL_ESTABLISHING_AUTH_SDK_METHODS: [&str; 18] = [
    "signUp",
    "signup",
    "signIn",
    "signin",
    "signInWithPassword",
    "signInWithOtp",
    "signInWithOAuth",
    "signInWithEmail",
    "signInWithPhone",
    "signInAnonymously",
    "verifyOtp",
    "verifyEmail",
    "confirmOtp",
    "resetPasswordForEmail",
    "sendPasswordResetEmail",
    "handleOAuthCallback",
    "handleCallback",
    "exchangeCodeForSession",
];
const CREDENTIAL_OPERATION_NAMES: [&str; 19] = [
    "login",
    "signin",
    "signup",
    "signon",
    "register",
    "registration",
    "oauth",
    "oauthcallback",
    "otp",
    "verifyotp",
    "confirmotp",
    "verifyemail",
    "confirmemail",
    "verifycode",
    "confirmcode",
    "resetpassword",
    "forgotpassword",
    "recoverpassword",
    "magiclink",
];
const CREDENTIAL_OPERATION_PREFIX_NAMES: [&str; 24] = [
    "login",
    "signin",
    "signup",
    "signon",
    "register",
    "registration",
    "oauth",
    "oauthcallback",
    "otp",
    "verifyotp",
    "confirmotp",
    "verifyemail",
    "confirmemail",
    "verifycode",
    "confirmcode",
    "resetpassword",
    "forgotpassword",
    "recoverpassword",
    "magiclink",
    "createaccount",
    "emailverification",
    "handleoauthcallback",
    "passwordreset",
    "verifyauthcode",
];

#[derive(Debug, Default, Clone)]
pub struct ServerAuthActions;

#[derive(Clone)]
struct ServerAuthCandidate {
    function_id: NodeId,
    display_name: String,
    report_span: Span,
}

struct ServerAuthExecutionGraph {
    function_ids: Vec<NodeId>,
    parameter_values: FxHashMap<SymbolId, Vec<NodeId>>,
}

declare_oxc_lint!(
    /// Require authentication before privileged work in exported server actions.
    ServerAuthActions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unauthenticated server action can be called directly.",
);

impl Rule for ServerAuthActions {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !server_auth_is_non_production_path(&ctx.file_path().to_string_lossy())
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let normalized_path = ctx.file_path().to_string_lossy().replace('\\', "/");
        if server_auth_is_test_app_source(&normalized_path) {
            return;
        }
        let file_has_use_server = ctx
            .nodes()
            .program()
            .directives
            .iter()
            .any(|directive| directive.directive == "use server");
        let custom_auth_names = server_auth_custom_function_names(ctx);
        let mut inspected_function_ids = FxHashSet::default();
        for candidate in server_auth_candidates(ctx) {
            if !inspected_function_ids.insert(candidate.function_id) {
                continue;
            }
            server_auth_inspect_candidate(&candidate, file_has_use_server, &custom_auth_names, ctx);
        }
    }
}

fn server_auth_inspect_candidate(
    candidate: &ServerAuthCandidate,
    file_has_use_server: bool,
    custom_auth_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) {
    if !file_has_use_server && !server_auth_function_has_use_server(candidate.function_id, ctx) {
        return;
    }
    if server_auth_is_component_like(candidate, ctx)
        || server_auth_is_exact_credential_action_name(&candidate.display_name)
        || server_auth_identifier_words(&candidate.display_name)
            .iter()
            .any(|word| word == "public")
    {
        return;
    }
    let execution_graph = server_auth_collect_execution_graph(candidate.function_id, ctx);
    if server_auth_has_credential_name_signal(&candidate.display_name)
        && server_auth_graph_contains_credential_call(&execution_graph, ctx)
    {
        return;
    }
    if server_auth_has_auth_before_privileged_work(
        candidate.function_id,
        custom_auth_names,
        ctx,
        &mut FxHashSet::default(),
    ) {
        return;
    }
    if let Some(secret_name) = server_auth_returned_module_secret(candidate.function_id, ctx) {
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "Server action \"{}\" returns the module-scoped secret \"{secret_name}\" without authentication, so anyone can retrieve it directly.",
                candidate.display_name
            ))
            .with_label(candidate.report_span),
        );
        return;
    }
    if execution_graph.function_ids.len() == 1
        && server_auth_is_cookie_deletion_only(candidate.function_id, ctx)
    {
        return;
    }
    let Some(side_effect) = server_auth_first_privileged_work(&execution_graph, ctx) else {
        return;
    };
    ctx.diagnostic(
        OxcDiagnostic::error(format!(
            "Server action \"{}\" performs unauthenticated privileged server work ({side_effect}), so anyone can trigger it directly.",
            candidate.display_name
        ))
        .with_label(candidate.report_span),
    );
}

fn server_auth_is_cookie_deletion_only(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let mut has_cookie_deletion = false;
    for node in ctx.nodes().iter() {
        if server_auth_nearest_function_id(node.id(), ctx) != Some(function_id) {
            continue;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        let Some(description) = server_auth_call_privileged_description(call, ctx) else {
            continue;
        };
        if description != "cookies().delete()" {
            return false;
        }
        has_cookie_deletion = true;
    }
    has_cookie_deletion
}

fn server_auth_candidates(ctx: &LintContext<'_>) -> Vec<ServerAuthCandidate> {
    let mut candidates = Vec::new();
    for node in ctx.nodes().iter() {
        let Some((function_id, is_async, identifier_name, identifier_span)) =
            server_auth_function_details(node)
        else {
            continue;
        };
        if !is_async {
            continue;
        }
        let mut display_name = identifier_name.map(str::to_string);
        let mut report_span = identifier_span.unwrap_or(node.span());
        let mut is_exported = false;
        for ancestor in ctx.nodes().ancestors(node.id()) {
            match ancestor.kind() {
                AstKind::ExportDeclaration(_) => {
                    is_exported = true;
                    break;
                }
                AstKind::ExportDefaultDeclaration(_) => {
                    is_exported = true;
                    display_name.get_or_insert_with(|| "default".to_string());
                    report_span = identifier_span.unwrap_or(ancestor.span());
                    break;
                }
                AstKind::VariableDeclarator(declarator) => {
                    if let Some(binding) = declarator.id.get_binding_identifier() {
                        display_name = Some(binding.name.to_string());
                        report_span = binding.span;
                        if server_auth_symbol_is_exported(binding.symbol_id(), ctx) {
                            is_exported = true;
                            break;
                        }
                    }
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    if ancestor.id() != node.id() =>
                {
                    break;
                }
                _ => {}
            }
        }
        if !is_exported
            && let Some(export_span) = server_auth_function_symbol_id(node, ctx)
                .and_then(|symbol_id| server_auth_symbol_export_span(symbol_id, ctx))
        {
            is_exported = true;
            report_span = export_span;
        }
        if is_exported {
            candidates.push(ServerAuthCandidate {
                function_id,
                display_name: display_name.unwrap_or_else(|| "anonymous".to_string()),
                report_span,
            });
        }
    }
    candidates
}

fn server_auth_function_details<'a>(
    node: &'a AstNode<'a>,
) -> Option<(NodeId, bool, Option<&'a str>, Option<Span>)> {
    match node.kind() {
        AstKind::Function(function) => Some((
            function.node_id.get(),
            function.r#async,
            function
                .id
                .as_ref()
                .map(|identifier| identifier.name.as_str()),
            function.id.as_ref().map(|identifier| identifier.span),
        )),
        AstKind::ArrowFunctionExpression(function) => {
            Some((function.node_id.get(), function.r#async, None, None))
        }
        _ => None,
    }
}

fn server_auth_function_symbol_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<SymbolId> {
    match node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        _ => {
            let parent = ctx.nodes().parent_node(node.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
    }
}

fn server_auth_symbol_is_exported(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    server_auth_symbol_export_span(symbol_id, ctx).is_some()
}

fn server_auth_symbol_export_span(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<Span> {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .find_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root_id = server_auth_transparent_root_id(reference_node.id(), ctx);
            matches!(
                ctx.nodes().parent_node(root_id).kind(),
                AstKind::ExportSpecifier(_) | AstKind::ExportDefaultDeclaration(_)
            )
            .then_some(reference_node.span())
        })
}

fn server_auth_function_has_use_server(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.body.as_ref().is_some_and(|body| {
            body.directives
                .iter()
                .any(|directive| directive.directive == "use server")
        }),
        AstKind::ArrowFunctionExpression(function) => {
            function.get_function_body().is_some_and(|body| {
                body.directives
                    .iter()
                    .any(|directive| directive.directive == "use server")
            })
        }
        _ => false,
    }
}

fn server_auth_collect_execution_graph(
    root_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> ServerAuthExecutionGraph {
    let mut function_ids = Vec::new();
    let mut parameter_values = FxHashMap::default();
    let mut pending = vec![root_function_id];
    let mut visited = FxHashSet::default();
    while let Some(function_id) = pending.pop() {
        if !visited.insert(function_id) {
            continue;
        }
        function_ids.push(function_id);
        let function_node = ctx.nodes().get_node(function_id);
        for candidate in ctx.nodes().iter() {
            if server_auth_nearest_function_id(candidate.id(), ctx) != Some(function_id)
                || !is_node_reachable_within_function(candidate, function_node, ctx)
            {
                continue;
            }
            match candidate.kind() {
                AstKind::CallExpression(call) => {
                    if let Some(helper_id) = server_auth_exact_local_function_id(
                        &call.callee,
                        ctx,
                        &mut FxHashSet::default(),
                    ) {
                        server_auth_record_parameter_values(
                            helper_id,
                            call,
                            &mut parameter_values,
                            ctx,
                        );
                        pending.push(helper_id);
                    } else if let Expression::Identifier(callee) =
                        call.callee.get_inner_expression()
                        && let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(callee.reference_id())
                            .symbol_id()
                    {
                        for value_node_id in parameter_values.get(&symbol_id).into_iter().flatten()
                        {
                            let value_node = ctx.nodes().get_node(*value_node_id);
                            if let Some(callback_id) =
                                server_auth_local_function_id_from_node(value_node, ctx)
                            {
                                pending.push(callback_id);
                            }
                        }
                    }
                    for (argument_index, argument) in call.arguments.iter().enumerate() {
                        let Some(argument) = argument.as_expression() else {
                            continue;
                        };
                        let Some(callback_id) = server_auth_exact_local_function_id(
                            argument,
                            ctx,
                            &mut FxHashSet::default(),
                        ) else {
                            continue;
                        };
                        if server_auth_call_executes_callback(call, argument_index, ctx) {
                            pending.push(callback_id);
                        }
                    }
                }
                AstKind::NewExpression(construction)
                    if matches!(construction.callee.get_inner_expression(), Expression::Identifier(callee)
                        if callee.name == "Promise"
                            && ctx
                                .scoping()
                                .get_reference(callee.reference_id())
                                .symbol_id()
                                .is_none()) =>
                {
                    if let Some(callback_id) = construction
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(|argument| {
                            server_auth_exact_local_function_id(
                                argument,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                        })
                    {
                        pending.push(callback_id);
                    }
                }
                _ => {}
            }
        }
    }
    ServerAuthExecutionGraph {
        function_ids,
        parameter_values,
    }
}

fn server_auth_record_parameter_values(
    function_id: NodeId,
    call: &oxc_ast::ast::CallExpression<'_>,
    parameter_values: &mut FxHashMap<SymbolId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return,
    };
    for (index, parameter) in parameters.items.iter().enumerate() {
        let Some(binding) = parameter.pattern.get_binding_identifier() else {
            continue;
        };
        let Some(argument) = call.arguments.get(index).and_then(Argument::as_expression) else {
            continue;
        };
        parameter_values
            .entry(binding.symbol_id())
            .or_default()
            .push(
                ctx.nodes()
                    .iter()
                    .find(|node| node.span() == argument.span())
                    .map_or(call.node_id.get(), AstNode::id),
            );
    }
}

fn server_auth_has_auth_before_privileged_work(
    function_id: NodeId,
    custom_auth_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited.insert(function_id) {
        return false;
    }
    let body_span = server_auth_function_body_span(function_id, ctx);
    let function_node = ctx.nodes().get_node(function_id);
    let mut direct_nodes = ctx
        .nodes()
        .iter()
        .filter(|node| {
            body_span.is_some_and(|span| span.contains_inclusive(node.span()))
                && server_auth_nearest_function_id(node.id(), ctx) == Some(function_id)
                && is_node_reachable_within_function(node, function_node, ctx)
        })
        .collect::<Vec<_>>();
    direct_nodes.sort_unstable_by_key(|node| node.span().start);
    let mut top_level_statement_starts = FxHashSet::default();
    for node in direct_nodes {
        let Some(statement_start) = server_auth_direct_statement_start(node.id(), function_id, ctx)
        else {
            continue;
        };
        top_level_statement_starts.insert(statement_start);
        if top_level_statement_starts.len() > AUTH_CHECK_LOOKAHEAD_STATEMENTS {
            return false;
        }
        let is_conditional = server_auth_node_is_conditional(node.id(), function_id, ctx);
        let AstKind::CallExpression(call) = node.kind() else {
            if server_auth_direct_privileged_description(node, ctx).is_some() {
                return false;
            }
            continue;
        };
        if !is_conditional && server_auth_call_auth_name(call, custom_auth_names, ctx).is_some() {
            return true;
        }
        if let Some(helper_id) =
            server_auth_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
        {
            if !is_conditional
                && server_auth_has_auth_before_privileged_work(
                    helper_id,
                    custom_auth_names,
                    ctx,
                    &mut visited.clone(),
                )
            {
                return true;
            }
            if server_auth_function_contains_privileged_work(
                helper_id,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return false;
            }
        }
        if server_auth_call_privileged_description(call, ctx).is_some() {
            return false;
        }
    }
    false
}

fn server_auth_first_privileged_work(
    graph: &ServerAuthExecutionGraph,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let _ = &graph.parameter_values;
    for function_id in &graph.function_ids {
        let function_node = ctx.nodes().get_node(*function_id);
        let mut nodes = ctx
            .nodes()
            .iter()
            .filter(|node| {
                server_auth_nearest_function_id(node.id(), ctx) == Some(*function_id)
                    && is_node_reachable_within_function(node, function_node, ctx)
            })
            .collect::<Vec<_>>();
        nodes.sort_unstable_by_key(|node| node.span().start);
        for node in nodes {
            if let Some(description) = server_auth_direct_privileged_description(node, ctx) {
                return Some(description);
            }
        }
    }
    None
}

fn server_auth_function_contains_privileged_work(
    function_id: NodeId,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited.insert(function_id) {
        return false;
    }
    let function_node = ctx.nodes().get_node(function_id);
    for node in ctx.nodes().iter() {
        if server_auth_nearest_function_id(node.id(), ctx) != Some(function_id)
            || !is_node_reachable_within_function(node, function_node, ctx)
        {
            continue;
        }
        if server_auth_direct_privileged_description(node, ctx).is_some() {
            return true;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if let Some(helper_id) =
            server_auth_exact_local_function_id(&call.callee, ctx, &mut FxHashSet::default())
            && server_auth_function_contains_privileged_work(helper_id, ctx, &mut visited.clone())
        {
            return true;
        }
    }
    false
}

fn server_auth_direct_privileged_description(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match node.kind() {
        AstKind::CallExpression(call) => server_auth_call_privileged_description(call, ctx),
        AstKind::AssignmentExpression(assignment) => {
            server_auth_module_state_target_name(&assignment.left, ctx)
                .map(|name| format!("{name} module-state assignment"))
        }
        AstKind::UpdateExpression(update) => {
            server_auth_module_state_simple_target_name(&update.argument, ctx)
                .map(|name| format!("{name} module-state update"))
        }
        AstKind::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
        {
            server_auth_module_state_expression_target_name(&unary.argument, ctx)
                .map(|name| format!("{name} module-state deletion"))
        }
        AstKind::TaggedTemplateExpression(template) => server_auth_mutating_sql(template, ctx),
        _ => None,
    }
}

fn server_auth_call_privileged_description(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let Some(imported_name) = server_auth_imported_mutation_call_name(call, ctx) {
        return Some(format!("imported {imported_name}()"));
    }
    if server_auth_mutating_fetch_method(call).is_some() {
        return Some(format!(
            "fetch() with method {}",
            server_auth_mutating_fetch_method(call)?
        ));
    }
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let method_name = member.static_property_name()?;
    if matches!(method_name, "set" | "append" | "delete")
        && server_auth_is_cookie_receiver(member.object(), ctx, &mut FxHashSet::default())
    {
        return Some(format!("cookies().{method_name}()"));
    }
    if BILLABLE_LANGCHAIN_METHOD_NAMES.contains(&method_name)
        && server_auth_is_tracked_langchain(member.object(), ctx, &mut FxHashSet::default())
    {
        return Some(format!("ChatOpenAI.{method_name}()"));
    }
    if !MUTATION_METHOD_NAMES.contains(&method_name)
        || server_auth_is_safe_receiver(member.object(), ctx, &mut FxHashSet::default())
    {
        return None;
    }
    let receiver_name = match member.object().get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    };
    Some(receiver_name.map_or_else(
        || format!(".{method_name}()"),
        |receiver_name| format!("{receiver_name}.{method_name}()"),
    ))
}

fn server_auth_is_cookies_call(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::AwaitExpression(awaited) => server_auth_is_cookies_call(&awaited.argument, ctx),
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return false;
            };
            if callee.name != "cookies" {
                return false;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id()
            else {
                return false;
            };
            server_auth_imported_name(symbol_id, ctx).as_deref() == Some("cookies")
                && server_auth_import_source(symbol_id, ctx).as_deref() == Some("next/headers")
        }
        _ => false,
    }
}

fn server_auth_is_cookie_receiver(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    if server_auth_is_cookies_call(expression, ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    server_auth_latest_symbol_value(symbol_id, identifier.span.start, ctx)
        .is_some_and(|value| server_auth_is_cookie_receiver(value, ctx, visited))
}

fn server_auth_call_auth_name(
    call: &oxc_ast::ast::CallExpression<'_>,
    custom_auth_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let name = identifier.name.as_str();
            if !AUTH_FUNCTION_NAMES.contains(&name)
                && !custom_auth_names.contains(name)
                && !server_auth_is_auth_guard_name(name)
            {
                return None;
            }
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            {
                let declaration = ctx.symbol_declaration(symbol_id);
                if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
                    return None;
                }
                if !matches!(
                    declaration.kind(),
                    AstKind::ImportSpecifier(_)
                        | AstKind::ImportDefaultSpecifier(_)
                        | AstKind::ImportNamespaceSpecifier(_)
                        | AstKind::Function(_)
                        | AstKind::VariableDeclarator(_)
                ) {
                    return None;
                }
            }
            Some(name.to_string())
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let method_name = member.static_property_name()?;
            if server_auth_receiver_originates_from_parameter(
                member.object(),
                ctx,
                &mut FxHashSet::default(),
            ) {
                return None;
            }
            if server_auth_is_auth_guard_name(method_name) {
                return Some(method_name.to_string());
            }
            if !AUTH_FUNCTION_NAMES.contains(&method_name)
                && !custom_auth_names.contains(method_name)
            {
                return None;
            }
            if method_name == "getUser"
                && !server_auth_dotted_source(member.object())
                    .to_ascii_lowercase()
                    .split(['.', '_'])
                    .any(server_auth_is_auth_object_token)
            {
                return None;
            }
            Some(method_name.to_string())
        }
        _ => None,
    }
}

fn server_auth_receiver_originates_from_parameter(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return server_auth_receiver_originates_from_parameter(member.object(), ctx, visited);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::FormalParameter(_) | AstKind::CatchParameter(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().is_some_and(|initializer| {
                server_auth_receiver_originates_from_parameter(initializer, ctx, visited)
            })
        }
        _ => false,
    }
}

fn server_auth_returned_module_secret(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    for node in ctx.nodes().iter() {
        if server_auth_nearest_function_id(node.id(), ctx) != Some(function_id) {
            continue;
        }
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if let Some(name) = statement.argument.as_ref().and_then(|argument| {
            server_auth_expression_secret_name(argument, ctx, &mut FxHashSet::default())
        }) {
            return Some(name);
        }
    }
    None
}

fn server_auth_expression_secret_name(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let binding_name = server_auth_imported_name(symbol_id, ctx)
                .unwrap_or_else(|| identifier.name.to_string());
            if server_auth_symbol_is_module_owned(symbol_id, ctx)
                && server_auth_is_likely_secret_name(&binding_name)
            {
                return Some(binding_name);
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            server_auth_expression_secret_name(declarator.init.as_ref()?, ctx, visited)
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let property_name = member.static_property_name()?;
            (server_auth_is_likely_secret_name(property_name)
                && server_auth_expression_originates_from_module(member.object(), ctx, visited))
            .then(|| property_name.to_string())
        }
        Expression::AwaitExpression(awaited) => {
            server_auth_expression_secret_name(&awaited.argument, ctx, visited)
        }
        Expression::ArrayExpression(array) => array.elements.iter().find_map(|element| {
            element.as_expression().and_then(|expression| {
                server_auth_expression_secret_name(expression, ctx, &mut visited.clone())
            })
        }),
        Expression::ObjectExpression(object) => object.properties.iter().find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            server_auth_expression_secret_name(&property.value, ctx, &mut visited.clone())
        }),
        Expression::ConditionalExpression(conditional) => {
            server_auth_expression_secret_name(&conditional.consequent, ctx, &mut visited.clone())
                .or_else(|| {
                    server_auth_expression_secret_name(
                        &conditional.alternate,
                        ctx,
                        &mut visited.clone(),
                    )
                })
        }
        Expression::LogicalExpression(logical) => {
            server_auth_expression_secret_name(&logical.left, ctx, &mut visited.clone()).or_else(
                || server_auth_expression_secret_name(&logical.right, ctx, &mut visited.clone()),
            )
        }
        Expression::BinaryExpression(binary) => {
            server_auth_expression_secret_name(&binary.left, ctx, &mut visited.clone()).or_else(
                || server_auth_expression_secret_name(&binary.right, ctx, &mut visited.clone()),
            )
        }
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.iter().find_map(|expression| {
                server_auth_expression_secret_name(expression, ctx, &mut visited.clone())
            })
        }
        Expression::TemplateLiteral(template) => {
            template.expressions.iter().find_map(|expression| {
                server_auth_expression_secret_name(expression, ctx, &mut visited.clone())
            })
        }
        _ => None,
    }
}

fn server_auth_expression_originates_from_module(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return server_auth_expression_originates_from_module(member.object(), ctx, visited);
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    if server_auth_symbol_is_module_owned(symbol_id, ctx) {
        return true;
    }
    matches!(ctx.symbol_declaration(symbol_id).kind(), AstKind::VariableDeclarator(declarator)
        if declarator.init.as_ref().is_some_and(|initializer|
            server_auth_expression_originates_from_module(initializer, ctx, visited)))
}

fn server_auth_symbol_is_module_owned(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
}

fn server_auth_is_likely_secret_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if ![
        "api_key",
        "apikey",
        "secret",
        "token",
        "password",
        "credential",
        "auth",
    ]
    .iter()
    .any(|part| lower.contains(part))
        || lower.contains("author")
    {
        return false;
    }
    let words = server_auth_identifier_words(name);
    if words
        .iter()
        .any(|word| matches!(word.as_str(), "anon" | "public" | "publishable"))
    {
        return false;
    }
    !words.last().is_some_and(|word| {
        matches!(
            word.as_str(),
            "endpoint" | "header" | "kind" | "name" | "type" | "uri" | "url"
        )
    })
}

fn server_auth_is_component_like(candidate: &ServerAuthCandidate, ctx: &LintContext<'_>) -> bool {
    if !candidate
        .display_name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    ctx.nodes().iter().any(|node| {
        if server_auth_nearest_function_id(node.id(), ctx) != Some(candidate.function_id)
            || !matches!(
                node.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            )
        {
            return false;
        }
        if matches!(ctx.nodes().get_node(candidate.function_id).kind(), AstKind::ArrowFunctionExpression(function)
            if function.get_expression().is_some_and(|expression| expression.span().contains_inclusive(node.span())))
        {
            return true;
        }
        ctx.nodes()
            .ancestors(node.id())
            .take_while(|ancestor| ancestor.id() != candidate.function_id)
            .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
    })
}

fn server_auth_graph_contains_credential_call(
    graph: &ServerAuthExecutionGraph,
    ctx: &LintContext<'_>,
) -> bool {
    graph.function_ids.iter().any(|function_id| {
        let function_node = ctx.nodes().get_node(*function_id);
        ctx.nodes().iter().any(|node| {
            if server_auth_nearest_function_id(node.id(), ctx) != Some(*function_id)
                || !is_node_reachable_within_function(node, function_node, ctx)
            {
                return false;
            }
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            CREDENTIAL_ESTABLISHING_AUTH_SDK_METHODS.contains(&method_name)
                && server_auth_dotted_source(member.object())
                    .to_ascii_lowercase()
                    .split(['.', '_'])
                    .any(server_auth_is_auth_object_token)
        })
    })
}

fn server_auth_is_exact_credential_action_name(name: &str) -> bool {
    let words = server_auth_merged_credential_words(name);
    let words = words
        .strip_suffix(&["action".to_string()])
        .unwrap_or(words.as_slice());
    CREDENTIAL_OPERATION_NAMES.contains(&words.concat().as_str())
}

fn server_auth_has_credential_name_signal(name: &str) -> bool {
    let words = server_auth_merged_credential_words(name);
    let words = words
        .strip_suffix(&["action".to_string()])
        .unwrap_or(words.as_slice());
    (1..=words.len()).rev().any(|length| {
        CREDENTIAL_OPERATION_PREFIX_NAMES.contains(&words[..length].concat().as_str())
    })
}

fn server_auth_merged_credential_words(name: &str) -> Vec<String> {
    let words = server_auth_identifier_words(name);
    let mut merged = Vec::new();
    let mut index = 0;
    while index < words.len() {
        if index + 1 < words.len()
            && ((words[index] == "sign" && matches!(words[index + 1].as_str(), "in" | "up" | "on"))
                || (words[index] == "log" && words[index + 1] == "in"))
        {
            merged.push(format!("{}{}", words[index], words[index + 1]));
            index += 2;
        } else {
            merged.push(words[index].clone());
            index += 1;
        }
    }
    merged
}

fn server_auth_is_auth_guard_name(name: &str) -> bool {
    let mut words = server_auth_identifier_words(name);
    let mut index = 0;
    while index + 1 < words.len() {
        if matches!(words[index].as_str(), "signed" | "logged" | "sign") && words[index + 1] == "in"
        {
            words[index] = format!("{}in", words[index]);
            words.remove(index + 1);
        } else {
            index += 1;
        }
    }
    let has_assertive = words.iter().any(|word| {
        matches!(
            word.as_str(),
            "require"
                | "ensure"
                | "assert"
                | "verify"
                | "validate"
                | "check"
                | "protect"
                | "enforce"
                | "guard"
                | "gate"
                | "restrict"
                | "is"
                | "has"
                | "can"
                | "must"
        )
    });
    let has_getter = words.iter().any(|word| {
        matches!(
            word.as_str(),
            "get" | "fetch" | "load" | "read" | "resolve" | "retrieve" | "use"
        )
    });
    let has_qualifier = words
        .iter()
        .any(|word| matches!(word.as_str(), "current" | "my" | "own"));
    let has_strong = words.iter().any(|word| {
        matches!(
            word.as_str(),
            "auth"
                | "authn"
                | "authz"
                | "authed"
                | "authenticate"
                | "authenticated"
                | "authenticating"
                | "authentication"
                | "authorize"
                | "authorized"
                | "authorizing"
                | "authorization"
                | "authorizer"
                | "signedin"
                | "loggedin"
                | "signin"
                | "session"
                | "sessions"
                | "login"
                | "admin"
                | "admins"
                | "superadmin"
                | "superuser"
                | "role"
                | "roles"
                | "permission"
                | "permissions"
                | "jwt"
                | "identity"
                | "principal"
                | "credential"
                | "credentials"
        )
    });
    let has_weak = words.iter().any(|word| {
        matches!(
            word.as_str(),
            "user"
                | "users"
                | "account"
                | "accounts"
                | "token"
                | "tokens"
                | "access"
                | "me"
                | "viewer"
                | "caller"
                | "subject"
                | "scope"
                | "scopes"
        )
    });
    words.iter().any(|word| {
        matches!(
            word.as_str(),
            "auth"
                | "authn"
                | "authz"
                | "authed"
                | "authenticate"
                | "authenticated"
                | "authentication"
                | "authorize"
                | "authorized"
                | "authorization"
                | "signedin"
                | "loggedin"
                | "signin"
        )
    }) || has_assertive && (has_strong || has_weak)
        || has_getter && has_strong
        || has_qualifier && has_weak
}

fn server_auth_identifier_words(identifier: &str) -> Vec<String> {
    let characters = identifier.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        if characters[index].is_ascii_digit() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        } else if characters[index].is_ascii_uppercase() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                if index + 1 < characters.len() && characters[index + 1].is_ascii_lowercase() {
                    break;
                }
                index += 1;
            }
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        } else {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        }
        words.push(
            characters[start..index]
                .iter()
                .collect::<String>()
                .to_ascii_lowercase(),
        );
    }
    words
}

fn server_auth_exact_local_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited.insert(symbol_id) {
                return None;
            }
            match ctx.symbol_declaration(symbol_id).kind() {
                AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => {
                    server_auth_exact_local_function_id(declarator.init.as_ref()?, ctx, visited)
                }
                AstKind::FormalParameter(_) => None,
                _ => None,
            }
        }
        _ => None,
    }
}

fn server_auth_local_function_id_from_node(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    match node.kind() {
        AstKind::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
        AstKind::IdentifierReference(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            match ctx.symbol_declaration(symbol_id).kind() {
                AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => server_auth_exact_local_function_id(
                    declarator.init.as_ref()?,
                    ctx,
                    &mut FxHashSet::default(),
                ),
                _ => None,
            }
        }
        _ => None,
    }
}

fn server_auth_call_executes_callback(
    call: &oxc_ast::ast::CallExpression<'_>,
    argument_index: usize,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
        let Some(method_name) = member.static_property_name() else {
            return false;
        };
        if method_name == "from"
            && argument_index == 1
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Array"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none())
        {
            return !matches!(
                call.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression),
                Some(Expression::ArrayExpression(array)) if array.elements.is_empty()
            );
        }
        if argument_index != 0
            || !matches!(
                method_name,
                "every"
                    | "filter"
                    | "find"
                    | "findIndex"
                    | "flatMap"
                    | "forEach"
                    | "map"
                    | "reduce"
                    | "reduceRight"
                    | "some"
                    | "sort"
            )
        {
            return false;
        }
        return server_auth_is_proven_sync_collection(
            member.object(),
            ctx,
            &mut FxHashSet::default(),
        ) && !server_auth_has_direct_static_property_write_before(
            member.object(),
            method_name,
            call.span.start,
            ctx,
        );
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
        .is_none()
        && ((callee.name == "Promise" && argument_index == 0)
            || (callee.name == "Array" && argument_index == 1))
}

fn server_auth_is_proven_sync_collection(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::NewExpression(construction) => {
            matches!(construction.callee.get_inner_expression(), Expression::Identifier(callee)
                if matches!(callee.name.as_str(), "Array" | "Map" | "Set")
                    && ctx.scoping().get_reference(callee.reference_id()).symbol_id().is_none())
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited.insert(symbol_id) {
                return false;
            }
            if server_auth_symbol_has_synchronous_collection_type(symbol_id, ctx) {
                return true;
            }
            matches!(ctx.symbol_declaration(symbol_id).kind(), AstKind::VariableDeclarator(declarator)
                if matches!(ctx.nodes().parent_node(ctx.symbol_declaration(symbol_id).id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                    && declarator.init.as_ref().is_some_and(|initializer|
                        server_auth_is_proven_sync_collection(initializer, ctx, visited)))
        }
        _ => false,
    }
}

fn server_auth_symbol_has_synchronous_collection_type(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let type_annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator.type_annotation.as_ref(),
        AstKind::FormalParameter(parameter) => parameter.type_annotation.as_ref(),
        _ => None,
    };
    type_annotation.is_some_and(|annotation| {
        server_auth_is_synchronous_collection_type(&annotation.type_annotation, ctx)
    })
}

fn server_auth_is_synchronous_collection_type(
    type_node: &TSType<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match type_node {
        TSType::TSArrayType(_) | TSType::TSTupleType(_) => true,
        TSType::TSTypeReference(reference) => matches!(
            &reference.type_name,
            TSTypeName::IdentifierReference(identifier)
                if matches!(
                    identifier.name.as_str(),
                    "Array" | "ReadonlyArray" | "Map" | "ReadonlyMap" | "Set" | "ReadonlySet"
                ) && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        ),
        TSType::TSUnionType(union) => {
            let mut has_collection_type = false;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                ) {
                    continue;
                }
                if !server_auth_is_synchronous_collection_type(member, ctx) {
                    return false;
                }
                has_collection_type = true;
            }
            has_collection_type
        }
        _ => false,
    }
}

fn server_auth_has_direct_static_property_write_before(
    expression: &Expression<'_>,
    property_name: &str,
    before_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            if identifier_node.span().start >= before_offset {
                return false;
            }
            let member_node = ctx.nodes().parent_node(identifier_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some(property_name) {
                return false;
            }
            let parent = ctx.nodes().parent_node(member_node.id());
            matches!(parent.kind(), AstKind::AssignmentExpression(assignment)
                if assignment.left.span().contains_inclusive(member_node.span()))
                || matches!(parent.kind(), AstKind::UpdateExpression(_))
                || matches!(parent.kind(), AstKind::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::Delete)
        })
}

fn server_auth_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn server_auth_function_body_span(function_id: NodeId, ctx: &LintContext<'_>) -> Option<Span> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.span()),
        _ => None,
    }
}

fn server_auth_direct_statement_start(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<u32> {
    let mut statement_start = None;
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == function_id {
            break;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ExpressionStatement(_)
                | AstKind::VariableDeclaration(_)
                | AstKind::ReturnStatement(_)
                | AstKind::ThrowStatement(_)
                | AstKind::IfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::SwitchStatement(_)
                | AstKind::TryStatement(_)
        ) {
            statement_start = Some(ancestor.span().start);
        }
    }
    statement_start
}

fn server_auth_node_is_conditional(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != function_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::IfStatement(_)
                    | AstKind::ConditionalExpression(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchCase(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
                    | AstKind::CatchClause(_)
            )
        })
}

fn server_auth_module_state_target_name(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            server_auth_module_identifier_name(identifier, ctx)
        }
        oxc_ast::ast::AssignmentTarget::StaticMemberExpression(member) => {
            server_auth_root_identifier(&member.object)
                .and_then(|identifier| server_auth_module_identifier_name(identifier, ctx))
        }
        oxc_ast::ast::AssignmentTarget::ComputedMemberExpression(member) => {
            server_auth_root_identifier(&member.object)
                .and_then(|identifier| server_auth_module_identifier_name(identifier, ctx))
        }
        _ => None,
    }
}

fn server_auth_module_state_simple_target_name(
    target: &oxc_ast::ast::SimpleAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match target {
        oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            server_auth_module_identifier_name(identifier, ctx)
        }
        oxc_ast::ast::SimpleAssignmentTarget::StaticMemberExpression(member) => {
            server_auth_root_identifier(&member.object)
                .and_then(|identifier| server_auth_module_identifier_name(identifier, ctx))
        }
        oxc_ast::ast::SimpleAssignmentTarget::ComputedMemberExpression(member) => {
            server_auth_root_identifier(&member.object)
                .and_then(|identifier| server_auth_module_identifier_name(identifier, ctx))
        }
        _ => None,
    }
}

fn server_auth_module_state_expression_target_name(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    server_auth_root_identifier(expression)
        .and_then(|identifier| server_auth_module_identifier_name(identifier, ctx))
}

fn server_auth_module_identifier_name(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id();
    (identifier.name == "globalThis" && symbol_id.is_none()
        || symbol_id.is_some_and(|symbol_id| server_auth_symbol_is_module_owned(symbol_id, ctx)))
    .then(|| identifier.name.to_string())
}

fn server_auth_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut expression = expression.get_inner_expression();
    loop {
        if let Some(member) = expression.as_member_expression() {
            expression = member.object().get_inner_expression();
            continue;
        }
        match expression {
            Expression::Identifier(identifier) => return Some(identifier),
            _ => return None,
        }
    }
}

fn server_auth_imported_mutation_call_name(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::ImportSpecifier(_)
            ) {
                return None;
            }
            let imported_name = server_auth_imported_name(symbol_id, ctx)
                .unwrap_or_else(|| identifier.name.to_string());
            server_auth_is_imported_mutation_name(&imported_name).then_some(imported_name)
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()?;
            if !matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::ImportNamespaceSpecifier(_)
            ) {
                return None;
            }
            let name = member.static_property_name()?.to_string();
            server_auth_is_imported_mutation_name(&name).then_some(name)
        }
        _ => None,
    }
}

fn server_auth_imported_name(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<String> {
    let AstKind::ImportSpecifier(specifier) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    Some(match &specifier.imported {
        ModuleExportName::IdentifierName(identifier) => identifier.name.to_string(),
        ModuleExportName::IdentifierReference(identifier) => identifier.name.to_string(),
        ModuleExportName::StringLiteral(literal) => literal.value.to_string(),
    })
}

fn server_auth_is_imported_mutation_name(name: &str) -> bool {
    let words = server_auth_identifier_words(name);
    words.len() >= 2
        && matches!(words[0].as_str(), "apply" | "execute" | "perform" | "run")
        && words[1..].iter().any(|word| {
            matches!(
                word.as_str(),
                "append"
                    | "create"
                    | "delete"
                    | "destroy"
                    | "insert"
                    | "mutate"
                    | "persist"
                    | "remove"
                    | "set"
                    | "update"
                    | "upsert"
                    | "write"
            )
        })
}

fn server_auth_mutating_fetch_method(call: &oxc_ast::ast::CallExpression<'_>) -> Option<String> {
    if !matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "fetch")
    {
        return None;
    }
    let Expression::ObjectExpression(options) = call
        .arguments
        .get(1)?
        .as_expression()?
        .get_inner_expression()
    else {
        return None;
    };
    options.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.key.static_name().as_deref() != Some("method") {
            return None;
        }
        let Expression::StringLiteral(method) = property.value.get_inner_expression() else {
            return None;
        };
        let method = method.value.to_ascii_uppercase();
        matches!(method.as_str(), "POST" | "PUT" | "DELETE" | "PATCH").then_some(method)
    })
}

fn server_auth_is_safe_receiver(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(construction) => {
            let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
                return false;
            };
            if matches!(
                callee.name.as_str(),
                "Map"
                    | "Set"
                    | "WeakMap"
                    | "WeakSet"
                    | "Headers"
                    | "URLSearchParams"
                    | "FormData"
                    | "Response"
            ) {
                return ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                    .is_none();
            }
            callee.name == "NextResponse"
                && ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| {
                        server_auth_import_source(symbol_id, ctx).as_deref() == Some("next/server")
                    })
        }
        Expression::CallExpression(call) => match call.callee.get_inner_expression() {
            Expression::Identifier(callee) => {
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                else {
                    return false;
                };
                callee.name == "headers"
                    && server_auth_import_source(symbol_id, ctx).as_deref() == Some("next/headers")
                    || matches!(
                        callee.name.as_str(),
                        "createHash"
                            | "createHmac"
                            | "createSign"
                            | "createVerify"
                            | "createCipheriv"
                            | "createDecipheriv"
                    ) && matches!(
                        server_auth_import_source(symbol_id, ctx).as_deref(),
                        Some("crypto" | "node:crypto")
                    )
            }
            expression if expression.as_member_expression().is_some() => {
                let member = expression.as_member_expression().unwrap();
                let Some(method_name) = member.static_property_name() else {
                    return false;
                };
                let Expression::Identifier(receiver) = member.object().get_inner_expression()
                else {
                    return false;
                };
                if !matches!(
                    method_name,
                    "json" | "redirect" | "next" | "rewrite" | "error"
                ) {
                    return false;
                }
                if receiver.name == "Response" {
                    return ctx
                        .scoping()
                        .get_reference(receiver.reference_id())
                        .symbol_id()
                        .is_none();
                }
                receiver.name == "NextResponse"
                    && ctx
                        .scoping()
                        .get_reference(receiver.reference_id())
                        .symbol_id()
                        .is_some_and(|symbol_id| {
                            server_auth_import_source(symbol_id, ctx).as_deref()
                                == Some("next/server")
                        })
            }
            _ => false,
        },
        Expression::AwaitExpression(awaited) => {
            server_auth_is_safe_receiver(&awaited.argument, ctx, visited)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited.insert(symbol_id) {
                return false;
            }
            server_auth_latest_symbol_value(symbol_id, identifier.span.start, ctx)
                .is_some_and(|value| server_auth_is_safe_receiver(value, ctx, visited))
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression().unwrap();
            matches!(
                member.static_property_name(),
                Some("headers" | "searchParams")
            ) && server_auth_is_safe_receiver(member.object(), ctx, visited)
        }
        _ => false,
    }
}

fn server_auth_is_tracked_langchain(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(construction) => {
            let Expression::Identifier(callee) = construction.callee.get_inner_expression() else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id()
            else {
                return false;
            };
            callee.name == "ChatOpenAI"
                && matches!(
                    ctx.symbol_declaration(symbol_id).kind(),
                    AstKind::ImportSpecifier(_)
                )
                && server_auth_import_source(symbol_id, ctx).as_deref() == Some("@langchain/openai")
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited.insert(symbol_id) {
                return false;
            }
            server_auth_latest_symbol_value(symbol_id, identifier.span.start, ctx)
                .is_some_and(|value| server_auth_is_tracked_langchain(value, ctx, visited))
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            member
                .static_property_name()
                .is_some_and(|name| LANGCHAIN_CHAINING_METHOD_NAMES.contains(&name))
                && (server_auth_is_tracked_langchain(member.object(), ctx, &mut visited.clone())
                    || call
                        .arguments
                        .iter()
                        .filter_map(Argument::as_expression)
                        .any(|argument| {
                            server_auth_is_tracked_langchain(argument, ctx, &mut visited.clone())
                        }))
        }
        _ => false,
    }
}

fn server_auth_latest_symbol_value<'a>(
    symbol_id: SymbolId,
    before_offset: u32,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let mut latest_value = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .map(|initializer| (declaration.span().start, initializer)),
        _ => None,
    };
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if reference_node.span().start >= before_offset {
            continue;
        }
        let root_id = server_auth_transparent_root_id(reference_node.id(), ctx);
        let parent = ctx.nodes().parent_node(root_id);
        let AstKind::AssignmentExpression(assignment) = parent.kind() else {
            continue;
        };
        if assignment
            .left
            .span()
            .contains_inclusive(reference_node.span())
            && latest_value.is_none_or(|(position, _)| parent.span().start > position)
        {
            latest_value = Some((parent.span().start, &assignment.right));
        }
    }
    latest_value.map(|(_, expression)| expression)
}

fn server_auth_import_source(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<String> {
    ctx.module_record().import_entries.iter().find_map(|entry| {
        (ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id))
        .then(|| entry.module_request.name().to_string())
    })
}

fn server_auth_mutating_sql(
    template: &oxc_ast::ast::TaggedTemplateExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let tag = template.tag.get_inner_expression();
    let symbol_id = match tag {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            (server_auth_imported_name(symbol_id, ctx).as_deref() == Some("sql"))
                .then_some(symbol_id)
        }
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            (member.static_property_name() == Some("sql"))
                .then(|| {
                    ctx.scoping()
                        .get_reference(receiver.reference_id())
                        .symbol_id()
                })
                .flatten()
        }
        _ => None,
    }?;
    if server_auth_import_source(symbol_id, ctx).as_deref() != Some("@vercel/postgres") {
        return None;
    }
    let prefix =
        server_auth_strip_sql_leading_comments(template.quasi.quasis.first()?.value.raw.as_str());
    let operation = prefix.split_whitespace().next()?.to_ascii_uppercase();
    matches!(
        operation.as_str(),
        "ALTER"
            | "CREATE"
            | "DELETE"
            | "DROP"
            | "GRANT"
            | "INSERT"
            | "MERGE"
            | "REPLACE"
            | "REVOKE"
            | "TRUNCATE"
            | "UPDATE"
    )
    .then(|| format!("sql tagged-template {operation}"))
}

fn server_auth_strip_sql_leading_comments(mut source: &str) -> &str {
    loop {
        source = source.trim_start();
        if let Some(rest) = source.strip_prefix("--") {
            source = rest
                .find(['\r', '\n'])
                .map_or("", |line_end| &rest[line_end + 1..]);
            continue;
        }
        if let Some(rest) = source.strip_prefix("/*")
            && let Some(comment_end) = rest.find("*/")
        {
            source = &rest[comment_end + 2..];
            continue;
        }
        return source;
    }
}

fn server_auth_dotted_source(expression: &Expression<'_>) -> String {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.to_string(),
        Expression::ThisExpression(_) => "this".to_string(),
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression().unwrap();
            let object = server_auth_dotted_source(member.object());
            member
                .static_property_name()
                .map_or(object.clone(), |property| {
                    if object.is_empty() {
                        property.to_string()
                    } else {
                        format!("{object}.{property}")
                    }
                })
        }
        _ => String::new(),
    }
}

fn server_auth_is_auth_object_token(token: &str) -> bool {
    [
        "auth",
        "authn",
        "authz",
        "clerk",
        "session",
        "jwt",
        "firebase",
        "supabase",
        "nextauth",
        "kinde",
        "workos",
        "stytch",
        "descope",
        "cognito",
        "propelauth",
        "lucia",
    ]
    .iter()
    .any(|signal| token.contains(signal))
}

fn server_auth_transparent_root_id(node_id: NodeId, ctx: &LintContext<'_>) -> NodeId {
    let mut root_id = node_id;
    loop {
        let parent = ctx.nodes().parent_node(root_id);
        if !matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::ChainExpression(_)
        ) {
            return root_id;
        }
        root_id = parent.id();
    }
}

fn server_auth_custom_function_names(ctx: &LintContext<'_>) -> FxHashSet<String> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("serverAuthFunctionNames"))
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn server_auth_is_non_production_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let is_app_router = server_auth_path_has_segment(&normalized, "app");
    let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
    let lowercase_basename = basename.to_ascii_lowercase();
    if [
        "setuptests.js",
        "setuptests.ts",
        "setuptests.jsx",
        "setuptests.tsx",
        "setupvitest.js",
        "setupvitest.ts",
        "setupvitest.jsx",
        "setupvitest.tsx",
        "setupjest.js",
        "setupjest.ts",
        "vitest.setup.js",
        "vitest.setup.ts",
        "vitest.setup.mjs",
        "vitest.config.ts",
        "vitest.config.js",
        "vitest.config.mts",
        "vitest.config.mjs",
        "jest.setup.js",
        "jest.setup.ts",
        "jest.setup.jsx",
        "jest.setup.tsx",
        "jest.config.js",
        "jest.config.ts",
        "jest.config.mjs",
        "playwright.config.ts",
        "playwright.config.js",
        "cypress.config.ts",
        "cypress.config.js",
        "karma.conf.js",
        "karma.conf.ts",
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
        "webpack.config.ts",
        "webpack.config.js",
        "webpack.config.mjs",
        "rollup.config.ts",
        "rollup.config.js",
        "rollup.config.mjs",
        "esbuild.config.ts",
        "esbuild.config.js",
        "esbuild.config.mjs",
        "tsup.config.ts",
        "tsup.config.js",
        "tsup.config.mjs",
        "rsbuild.config.ts",
        "rsbuild.config.js",
        "rspack.config.ts",
        "rspack.config.js",
        "next.config.ts",
        "next.config.js",
        "next.config.mjs",
        "remix.config.js",
        "remix.config.ts",
        "astro.config.ts",
        "astro.config.js",
        "astro.config.mjs",
        "tailwind.config.ts",
        "tailwind.config.js",
        "tailwind.config.mjs",
        "postcss.config.ts",
        "postcss.config.js",
        "postcss.config.mjs",
        "biome.config.ts",
        "biome.config.js",
        "drizzle.config.ts",
        "drizzle.config.js",
        "prisma.config.ts",
        "prisma.config.js",
        "knip.config.ts",
        "knip.config.js",
        "knip.config.mjs",
        "lint-staged.config.js",
        "lint-staged.config.mjs",
    ]
    .contains(&lowercase_basename.as_str())
        || [
            ".test.",
            ".spec.",
            ".cy.",
            ".stories.",
            ".story.",
            ".bench.",
            ".benchmark.",
            ".e2e.",
            ".integration-spec.",
            ".int-spec.",
            ".mock.",
            ".mocks.",
            ".fixture.",
        ]
        .iter()
        .any(|suffix| basename.contains(suffix))
    {
        return true;
    }
    let rooted_path = if normalized.starts_with('/') {
        normalized.clone()
    } else {
        format!("/{normalized}")
    };
    if ["/.storybook/", "/.dumi/"]
        .iter()
        .any(|segment| rooted_path.contains(segment))
    {
        return true;
    }
    let source_root_offset = [
        "/src/",
        "/app/",
        "/lib/",
        "/components/",
        "/pages/",
        "/features/",
        "/modules/",
        "/packages/",
        "/apps/",
        "/frontend/",
        "/client/",
    ]
    .iter()
    .filter_map(|segment| normalized.rfind(segment))
    .max();
    let scoped_path =
        source_root_offset.map_or(normalized.as_str(), |offset| &normalized[offset..]);
    [
        "/test/",
        "/tests/",
        "/testing/",
        "/__tests__/",
        "/__test__/",
        "/__fixtures__/",
        "/fixtures/",
        "/__mocks__/",
        "/mocks/",
        "/testUtils/",
        "/test-utils/",
        "/test-stubs/",
        "/testutils/",
        "/cypress/",
        "/playwright/",
        "/stories/",
        "/__stories__/",
        "/playground/",
        "/playgrounds/",
        "/examples/",
        "/example/",
        "/demo/",
        "/demos/",
        "/sandbox/",
        "/sandboxes/",
        "/e2e/",
        "/e2e-tests/",
        "/specs/",
        "/spec/",
        "/integration-tests/",
        "/integration/",
        "/it/",
        "/benchmarks/",
        "/benchmark/",
        "/__benchmarks__/",
        "/perf/",
        "/perf-tests/",
        "/scripts/",
        "/cli/",
        "/bin/",
        "/tooling/",
        "/tools/",
        "/codemods/",
        "/codemod/",
        "/migrations/",
        "/migration/",
        "/generators/",
        "/generator/",
        "/runbooks/",
        "/devtools/",
        "/internal-tools/",
        "/seeds/",
        "/seed/",
        "/dev-seeder/",
    ]
    .iter()
    .any(|segment| !(is_app_router && *segment == "/tools/") && scoped_path.contains(segment))
}

fn server_auth_is_test_app_source(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    normalized.starts_with("test/app/")
        || normalized.starts_with("test/src/")
        || normalized.contains("/test/app/")
        || normalized.contains("/test/src/")
}

fn server_auth_path_has_segment(path: &str, segment: &str) -> bool {
    path.starts_with(segment) && path.as_bytes().get(segment.len()) == Some(&b'/')
        || path.contains(&format!("/{segment}/"))
}
