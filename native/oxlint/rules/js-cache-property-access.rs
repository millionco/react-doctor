use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression, SimpleAssignmentTarget, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::node::NodeId;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const PROPERTY_ACCESS_REPEAT_THRESHOLD: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct JsCachePropertyAccess;

struct PropertyRead {
    key: String,
    count: usize,
    first_span: Span,
}

declare_oxc_lint!(
    /// Disallow repeated deep property reads inside one loop.
    JsCachePropertyAccess,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow repeated deep property reads inside one loop.",
);

impl Rule for JsCachePropertyAccess {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(loop_body) = loop_body(node.kind()) else {
            return;
        };
        let loop_body_span = loop_body.span();
        let mut property_reads = Vec::<PropertyRead>::new();
        let mut written_access_prefixes = FxHashSet::<String>::default();
        let mut called_receiver_prefixes = FxHashSet::<String>::default();

        for candidate in ctx.nodes().iter() {
            if !loop_body_span.contains_inclusive(candidate.span())
                || !is_in_same_loop_function_scope(candidate, node.id(), ctx)
            {
                continue;
            }
            match candidate.kind() {
                AstKind::AssignmentExpression(assignment_expression) => {
                    if let Some(write_target) = assignment_expression
                        .left
                        .as_simple_assignment_target()
                        .and_then(build_assignment_target_key)
                    {
                        written_access_prefixes.insert(write_target);
                    }
                }
                AstKind::UpdateExpression(update_expression) => {
                    if let Some(write_target) =
                        build_assignment_target_key(&update_expression.argument)
                    {
                        written_access_prefixes.insert(write_target);
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(receiver_key) = call_expression
                        .callee
                        .as_member_expression()
                        .and_then(|member_expression| {
                            build_expression_access_key(member_expression.object())
                        })
                    else {
                        continue;
                    };
                    if receiver_key.contains('.') {
                        called_receiver_prefixes.insert(receiver_key);
                    }
                }
                AstKind::StaticMemberExpression(member_expression) => {
                    let candidate_span = member_expression.span;
                    if is_nested_member_object(candidate_span, candidate, ctx)
                        || is_call_callee(candidate_span, candidate, ctx)
                        || is_write_target(candidate_span, candidate, ctx)
                    {
                        continue;
                    }
                    let Some(key) = build_static_member_access_key(member_expression) else {
                        continue;
                    };
                    if key.split('.').count() < 3 || key.ends_with(".length") {
                        continue;
                    }
                    if let Some(existing_read) = property_reads
                        .iter_mut()
                        .find(|property_read| property_read.key == key)
                    {
                        existing_read.count += 1;
                    } else {
                        property_reads.push(PropertyRead {
                            key,
                            count: 1,
                            first_span: candidate_span,
                        });
                    }
                }
                _ => {}
            }
        }

        for property_read in property_reads {
            if property_read.count < PROPERTY_ACCESS_REPEAT_THRESHOLD
                || extends_unstable_prefix(
                    &property_read.key,
                    &written_access_prefixes,
                    &called_receiver_prefixes,
                )
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This may slow the loop because {} is read {} times inside it; if the value stays unchanged between those reads, cache it immediately before the first read",
                    property_read.key, property_read.count
                ))
                .with_label(property_read.first_span),
            );
        }
    }
}

fn loop_body<'a>(kind: AstKind<'a>) -> Option<&'a Statement<'a>> {
    match kind {
        AstKind::ForStatement(statement) => Some(&statement.body),
        AstKind::ForInStatement(statement) => Some(&statement.body),
        AstKind::ForOfStatement(statement) => Some(&statement.body),
        AstKind::WhileStatement(statement) => Some(&statement.body),
        AstKind::DoWhileStatement(statement) => Some(&statement.body),
        _ => None,
    }
}

fn is_in_same_loop_function_scope(
    candidate: &AstNode<'_>,
    loop_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == loop_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn build_assignment_target_key(target: &SimpleAssignmentTarget<'_>) -> Option<String> {
    if let Some(member_expression) = target.as_member_expression() {
        return build_member_access_key(member_expression);
    }
    if let Some(identifier_name) = target.get_identifier_name() {
        return Some(identifier_name.to_string());
    }
    None
}

fn build_member_access_key(member_expression: &MemberExpression<'_>) -> Option<String> {
    let MemberExpression::StaticMemberExpression(member_expression) = member_expression else {
        return None;
    };
    build_static_member_access_key(member_expression)
}

fn build_static_member_access_key(
    member_expression: &oxc_ast::ast::StaticMemberExpression<'_>,
) -> Option<String> {
    let object_key = build_expression_access_key(&member_expression.object)?;
    Some(format!("{object_key}.{}", member_expression.property.name))
}

fn build_expression_access_key(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::ThisExpression(_) => Some("this".to_string()),
        Expression::StaticMemberExpression(member_expression) => {
            build_static_member_access_key(member_expression)
        }
        _ => None,
    }
}

fn is_nested_member_object(span: Span, node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().parent_node(node.id()).kind() {
        AstKind::StaticMemberExpression(member_expression) => {
            member_expression.object.span() == span
        }
        AstKind::ComputedMemberExpression(member_expression) => {
            member_expression.object.span() == span
        }
        AstKind::PrivateFieldExpression(member_expression) => {
            member_expression.object.span() == span
        }
        _ => false,
    }
}

fn is_call_callee(span: Span, node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(
        ctx.nodes().parent_node(node.id()).kind(),
        AstKind::CallExpression(call_expression) if call_expression.callee.span() == span
    )
}

fn is_write_target(span: Span, node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().parent_node(node.id()).kind() {
        AstKind::AssignmentExpression(assignment_expression) => {
            assignment_expression.left.span() == span
        }
        AstKind::UpdateExpression(update_expression) => update_expression.argument.span() == span,
        _ => false,
    }
}

fn extends_unstable_prefix(
    key: &str,
    written_access_prefixes: &FxHashSet<String>,
    called_receiver_prefixes: &FxHashSet<String>,
) -> bool {
    let mut access_prefix = String::new();
    for segment in key.split('.') {
        if !access_prefix.is_empty() {
            access_prefix.push('.');
        }
        access_prefix.push_str(segment);
        if written_access_prefixes.contains(&access_prefix)
            || called_receiver_prefixes.contains(&access_prefix)
        {
            return true;
        }
    }
    false
}
