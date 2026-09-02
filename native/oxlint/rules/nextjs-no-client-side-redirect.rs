use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, FunctionType, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Default, Clone)]
pub struct NextjsNoClientSideRedirect;

struct NextjsRedirectCandidateIndex {
    location_member_node_ids_by_start: Vec<NodeId>,
    timer_call_node_ids_by_start: Vec<NodeId>,
}

impl NextjsRedirectCandidateIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut location_member_node_ids_by_start = Vec::new();
        let mut timer_call_node_ids_by_start = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::StaticMemberExpression(member)
                    if matches!(member.property.name.as_str(), "pathname" | "asPath") =>
                {
                    location_member_node_ids_by_start.push(node.id());
                }
                AstKind::ComputedMemberExpression(member)
                    if matches!(&member.expression, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "pathname" | "asPath")) =>
                {
                    location_member_node_ids_by_start.push(node.id());
                }
                AstKind::CallExpression(call)
                    if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "setTimeout" | "setInterval")) =>
                {
                    timer_call_node_ids_by_start.push(node.id());
                }
                _ => {}
            }
        }
        location_member_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        timer_call_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self {
            location_member_node_ids_by_start,
            timer_call_node_ids_by_start,
        }
    }
}

declare_oxc_lint!(
    /// Disallow client-side redirects that run after the initial render.
    NextjsNoClientSideRedirect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow client-side redirects in effects."
);

impl Rule for NextjsNoClientSideRedirect {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_next_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let function_node_index = build_local_callback_nearest_function_node_index(ctx);
        let candidate_index = NextjsRedirectCandidateIndex::new(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let hook_name = match call.callee.get_inner_expression() {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                expression => expression
                    .as_member_expression()
                    .and_then(member_expression_identifier_property_name),
            };
            if !matches!(hook_name, Some("useEffect" | "useLayoutEffect")) {
                continue;
            }
            let Some(callback) = call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            if !matches!(
                callback,
                Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            nextjs_redirect_scan_execution(
                callback,
                &function_node_index,
                &candidate_index,
                ctx,
            );
        }
    }
}

fn nextjs_redirect_scan_execution(
    callback: &Expression<'_>,
    function_node_index: &LocalCallbackNearestFunctionNodeIndex,
    candidate_index: &NextjsRedirectCandidateIndex,
    ctx: &LintContext<'_>,
) {
    let callback_id = callback.node_id();
    let mut pending = vec![callback_id];
    let mut visited = FxHashSet::default();
    let mut functions = FxHashMap::default();
    let mut called_names = FxHashSet::default();
    let mut reassigned_names = FxHashSet::default();
    let mut timer_names = FxHashSet::default();

    let callback_span = callback.span();
    let first_timer_index = candidate_index
        .timer_call_node_ids_by_start
        .partition_point(|node_id| ctx.nodes().get_node(*node_id).span().start < callback_span.start);
    for timer_call_id in &candidate_index.timer_call_node_ids_by_start[first_timer_index..] {
        let candidate = ctx.nodes().get_node(*timer_call_id);
        if candidate.span().start > callback_span.end {
            break;
        }
        if !callback_span.contains_inclusive(candidate.span())
            || !nextjs_redirect_descendant(candidate.id(), callback_id, ctx)
        {
            continue;
        }
        if let AstKind::CallExpression(call) = candidate.kind()
            && let Some(Expression::Identifier(identifier)) = call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression)
        {
            timer_names.insert(identifier.name.to_string());
        }
    }

    while let Some(root_id) = pending.pop() {
        if !visited.insert(root_id) {
            continue;
        }
        let root_name = nextjs_redirect_function_binding_name(root_id, ctx);
        let is_polling_root = root_name
            .as_ref()
            .is_some_and(|name| timer_names.contains(name));
        for node_id in function_node_index.node_ids(root_id) {
            let candidate = ctx.nodes().get_node(*node_id);
            match candidate.kind() {
                AstKind::Function(function)
                    if candidate.id() != root_id
                        && function.r#type == FunctionType::FunctionDeclaration =>
                {
                    if let Some(identifier) = &function.id {
                        functions.insert(identifier.name.to_string(), candidate.id());
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(identifier) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    if let Some(function_id) = declarator
                        .init
                        .as_ref()
                        .and_then(nextjs_redirect_function_id)
                    {
                        functions.insert(identifier.name.to_string(), function_id);
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    if !is_polling_root {
                        if let Some(message) = nextjs_redirect_assignment_message(assignment) {
                            ctx.diagnostic(
                                OxcDiagnostic::warn(message).with_label(assignment.span),
                            );
                        }
                    }
                    if let AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                        &assignment.left
                    {
                        reassigned_names.insert(identifier.name.to_string());
                    }
                }
                AstKind::CallExpression(call) => {
                    if !is_polling_root
                        && let Some(message) = nextjs_redirect_call_message(call)
                        && !nextjs_redirect_same_page(
                            call.arguments
                                .first()
                                .and_then(oxc_ast::ast::Argument::as_expression),
                            candidate_index,
                            ctx,
                        )
                        && !nextjs_redirect_own_route(
                            call.arguments
                                .first()
                                .and_then(oxc_ast::ast::Argument::as_expression),
                            ctx,
                        )
                    {
                        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call.span));
                    }
                    let callee = call.callee.get_inner_expression();
                    if let Some(function_id) = nextjs_redirect_function_id(callee) {
                        pending.push(function_id);
                        continue;
                    }
                    if let Expression::Identifier(identifier) = callee {
                        called_names.insert(identifier.name.to_string());
                        continue;
                    }
                    let Some(member) = callee.as_member_expression() else {
                        continue;
                    };
                    if matches!(
                        member_expression_identifier_property_name(member),
                        Some("then" | "catch" | "finally")
                    ) && matches!(
                        member.object().get_inner_expression(),
                        Expression::CallExpression(_)
                    ) {
                        for argument in &call.arguments {
                            if let Some(function_id) = argument
                                .as_expression()
                                .and_then(nextjs_redirect_function_id)
                            {
                                pending.push(function_id);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        for name in &called_names {
            if !reassigned_names.contains(name) {
                if let Some(function_id) = functions.get(name) {
                    pending.push(*function_id);
                }
            }
        }
    }
}

fn nextjs_redirect_call_message(call: &oxc_ast::ast::CallExpression<'_>) -> Option<&'static str> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "router")
    {
        return None;
    }
    match member_expression_identifier_property_name(member) {
        Some("push") => {
            Some("router.push() in useEffect flashes the wrong page before redirecting.")
        }
        Some("replace") => {
            Some("router.replace() in useEffect flashes the wrong page before redirecting.")
        }
        _ => None,
    }
}

fn nextjs_redirect_assignment_message(
    assignment: &oxc_ast::ast::AssignmentExpression<'_>,
) -> Option<&'static str> {
    let member = assignment.left.as_member_expression()?;
    let object = member.object();
    let property = member_expression_identifier_property_name(member)?;
    if matches!(object, Expression::Identifier(identifier) if identifier.name == "window")
        && property == "location"
    {
        return Some(
            "window.location assignment in useEffect flashes the wrong page before redirecting.",
        );
    }
    if matches!(object, Expression::Identifier(identifier) if identifier.name == "location")
        && property == "href"
    {
        return Some(
            "location.href assignment in useEffect flashes the wrong page before redirecting.",
        );
    }
    None
}

fn nextjs_redirect_same_page(
    destination: Option<&Expression<'_>>,
    candidate_index: &NextjsRedirectCandidateIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(destination) = destination else {
        return false;
    };
    if let Expression::ObjectExpression(object) = destination {
        let pathname = object.properties.iter().find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (property_key_identifier_name(&property.key) == Some("pathname"))
                .then_some(&property.value)
        });
        return pathname.is_some_and(|pathname| {
            nextjs_redirect_reads_location(pathname.node_id(), candidate_index, ctx)
        });
    }
    if nextjs_redirect_reads_location(destination.node_id(), candidate_index, ctx) {
        return true;
    }
    if let Expression::Identifier(identifier) = destination
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
        && let Some(initializer) = &declarator.init
    {
        return nextjs_redirect_reads_location(initializer.node_id(), candidate_index, ctx);
    }
    false
}

fn nextjs_redirect_reads_location(
    root_id: oxc_semantic::NodeId,
    candidate_index: &NextjsRedirectCandidateIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let root_span = ctx.nodes().get_node(root_id).span();
    let first_candidate_index = candidate_index
        .location_member_node_ids_by_start
        .partition_point(|node_id| ctx.nodes().get_node(*node_id).span().start < root_span.start);
    candidate_index.location_member_node_ids_by_start[first_candidate_index..]
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .take_while(|candidate| candidate.span().start <= root_span.end)
        .any(|candidate| {
            root_span.contains_inclusive(candidate.span())
                && nextjs_redirect_descendant(candidate.id(), root_id, ctx)
        })
}

fn nextjs_redirect_own_route(destination: Option<&Expression<'_>>, ctx: &LintContext<'_>) -> bool {
    let Some(Expression::StringLiteral(value)) = destination else {
        return false;
    };
    let path = ctx.file_path().to_string_lossy().replace('\\', "/");
    let route = if let Some(index) = path
        .find("app/")
        .filter(|index| *index == 0 || path.as_bytes().get(index - 1) == Some(&b'/'))
    {
        let route = path[index + 4..]
            .strip_suffix("/page.tsx")
            .or_else(|| path[index + 4..].strip_suffix("/page.ts"))
            .or_else(|| path[index + 4..].strip_suffix("/page.jsx"))
            .or_else(|| path[index + 4..].strip_suffix("/page.js"));
        route.filter(|route| !route.is_empty())
    } else if let Some(index) = path
        .find("pages/")
        .filter(|index| *index == 0 || path.as_bytes().get(index - 1) == Some(&b'/'))
    {
        let pages_path = &path[index + 6..];
        pages_path
            .strip_suffix(".tsx")
            .or_else(|| pages_path.strip_suffix(".ts"))
            .or_else(|| pages_path.strip_suffix(".jsx"))
            .or_else(|| pages_path.strip_suffix(".js"))
            .map(|route| route.strip_suffix("/index").unwrap_or(route))
    } else {
        None
    };
    let Some(route) = route else { return false };
    let route = route
        .split('/')
        .filter(|segment| {
            !(segment.starts_with('(') && segment.ends_with(')'))
                && !segment.starts_with('@')
                && !matches!(
                    segment.to_ascii_lowercase().as_str(),
                    "[locale]" | "[lng]" | "[lang]" | "[language]"
                )
        })
        .collect::<Vec<_>>()
        .join("/");
    let destination = value
        .value
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    let destination = if destination.is_empty() {
        "/"
    } else {
        destination
    };
    destination == format!("/{route}")
}

fn nextjs_redirect_function_id(expression: &Expression<'_>) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        Expression::FunctionExpression(function) => Some(function.node_id()),
        Expression::ArrowFunctionExpression(function) => Some(function.node_id()),
        _ => None,
    }
}

fn nextjs_redirect_function_binding_name(
    root_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let node = ctx.nodes().get_node(root_id);
    match node.kind() {
        AstKind::Function(function)
            if function.r#type == FunctionType::FunctionDeclaration => function
            .id
            .as_ref()
            .map(|identifier| identifier.name.to_string()),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => match ctx
            .nodes()
            .parent_node(root_id)
            .kind()
        {
            AstKind::VariableDeclarator(declarator) => declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.name.to_string()),
            _ => None,
        },
        _ => None,
    }
}

fn nextjs_redirect_descendant(
    candidate_id: oxc_semantic::NodeId,
    root_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    candidate_id == root_id
        || ctx
            .nodes()
            .ancestors(candidate_id)
            .any(|ancestor| ancestor.id() == root_id)
}
