use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, BindingPattern, CallExpression, Expression, FormalParameters,
        MemberExpression, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MUTATING_ARRAY_METHOD_NAMES: &[&str] = &[
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];

#[derive(Debug, Default, Clone)]
pub struct JsIndexMaps;

declare_oxc_lint!(
    /// Suggests indexing a stable array before repeatedly searching it in a loop.
    JsIndexMaps,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "array.find() inside a loop",
);

impl Rule for JsIndexMaps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut loop_bound_names_by_node = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(member) = call.callee.as_member_expression() else {
                continue;
            };
            let Some(method_name) = member_expression_identifier_property_name(member) else {
                continue;
            };
            if !matches!(method_name, "find" | "findIndex")
                || !is_inside_index_map_loop(node, ctx)
                || !is_single_field_equality_predicate(call)
                || is_constant_table_receiver(member.object())
                || is_loop_variant_receiver(
                    member.object(),
                    node,
                    &mut loop_bound_names_by_node,
                    ctx,
                )
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This gets slow as your list grows because array.{method_name}() runs inside a loop, so build a Map once before the loop for instant lookups"
                ))
                .with_label(call.span),
            );
        }
    }
}

fn is_inside_index_map_loop<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::DoWhileStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::WhileStatement(_) => return true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn is_single_field_equality_predicate(call: &CallExpression<'_>) -> bool {
    let callback = call
        .arguments
        .first()
        .and_then(|argument| argument.as_expression());
    let Some(callback) = callback else {
        return false;
    };
    let (parameters, predicate) = match callback {
        Expression::ArrowFunctionExpression(function) => {
            let predicate = if let Some(expression) = function.get_expression() {
                expression
            } else {
                let Some(body) = function.get_function_body() else {
                    return false;
                };
                let Some(predicate) = single_return_expression(body) else {
                    return false;
                };
                predicate
            };
            (&function.params, predicate)
        }
        Expression::FunctionExpression(function) => {
            let Some(body) = function.body.as_ref() else {
                return false;
            };
            let Some(predicate) = single_return_expression(body) else {
                return false;
            };
            (&function.params, predicate)
        }
        _ => return false,
    };
    let Some(parameter_name) = first_argument_identifier_name(parameters) else {
        return false;
    };
    let Expression::BinaryExpression(binary) = predicate else {
        return false;
    };
    matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ) && (references_parameter(&binary.left, parameter_name)
        || references_parameter(&binary.right, parameter_name))
}

fn single_return_expression<'a>(
    body: &'a oxc_ast::ast::FunctionBody<'a>,
) -> Option<&'a Expression<'a>> {
    if !body.directives.is_empty() || body.statements.len() != 1 {
        return None;
    }
    let Statement::ReturnStatement(statement) = body.statements.first()? else {
        return None;
    };
    statement.argument.as_ref()
}

fn first_argument_identifier_name<'a>(parameters: &'a FormalParameters<'a>) -> Option<&'a str> {
    if let Some(parameter) = parameters.items.first() {
        let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
            return None;
        };
        return Some(identifier.name.as_str());
    }
    let BindingPattern::ArrayPattern(pattern) = &parameters.rest.as_ref()?.rest.argument else {
        return None;
    };
    if pattern.rest.is_some() || pattern.elements.len() != 1 {
        return None;
    }
    let BindingPattern::BindingIdentifier(identifier) = pattern.elements.first()?.as_ref()? else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn references_parameter(expression: &Expression<'_>, parameter_name: &str) -> bool {
    match expression {
        Expression::Identifier(identifier) => identifier.name == parameter_name,
        expression => expression
            .as_member_expression()
            .is_some_and(|member| references_parameter(member.object(), parameter_name)),
    }
}

fn is_constant_table_receiver(receiver: &Expression<'_>) -> bool {
    index_map_root_identifier_name(receiver).is_some_and(is_screaming_snake_name)
}

fn is_screaming_snake_name(name: &str) -> bool {
    name.len() >= 2
        && name.starts_with(|character: char| character.is_ascii_uppercase())
        && name.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}

fn is_loop_variant_receiver<'a>(
    receiver: &Expression<'a>,
    call_node: &AstNode<'a>,
    loop_bound_names_by_node: &mut FxHashMap<NodeId, FxHashSet<String>>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(receiver_root) = index_map_root_identifier_name(receiver) else {
        return true;
    };
    let mut enclosing_loop_ids = Vec::new();
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if is_index_map_loop_node(ancestor) {
            enclosing_loop_ids.push(ancestor.id());
            loop_bound_names_by_node
                .entry(ancestor.id())
                .or_insert_with(|| collect_loop_bound_names(ancestor, ctx));
        }
    }
    let loop_bound_names = enclosing_loop_ids
        .iter()
        .filter_map(|loop_id| loop_bound_names_by_node.get(loop_id))
        .flat_map(FxHashSet::iter)
        .cloned()
        .collect::<FxHashSet<_>>();
    loop_bound_names.contains(receiver_root)
        || has_loop_bound_computed_index(receiver, &loop_bound_names, ctx)
}

fn is_index_map_loop_node(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::DoWhileStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::WhileStatement(_)
    )
}

fn collect_loop_bound_names<'a>(
    loop_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    match loop_node.kind() {
        AstKind::ForInStatement(statement) => {
            collect_identifier_names_in_span(statement.left.span(), &mut names, ctx);
        }
        AstKind::ForOfStatement(statement) => {
            collect_identifier_names_in_span(statement.left.span(), &mut names, ctx);
        }
        _ => {}
    }
    for candidate in ctx.nodes().iter() {
        if !loop_node.span().contains_inclusive(candidate.span())
            || !belongs_to_loop_walk(candidate, loop_node.id(), ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::BindingIdentifier(identifier)
                if is_variable_declarator_binding_identifier(candidate, loop_node.id(), ctx) =>
            {
                names.insert(identifier.name.to_string());
            }
            AstKind::IdentifierName(identifier)
                if is_variable_declarator_binding_identifier(candidate, loop_node.id(), ctx) =>
            {
                names.insert(identifier.name.to_string());
            }
            AstKind::IdentifierReference(identifier)
                if is_variable_declarator_binding_identifier(candidate, loop_node.id(), ctx) =>
            {
                names.insert(identifier.name.to_string());
            }
            AstKind::AssignmentExpression(assignment) => {
                if let Some(name) = assignment_target_root_identifier_name(&assignment.left) {
                    names.insert(name.to_string());
                }
            }
            AstKind::CallExpression(call) => {
                let Some(member) = call.callee.as_member_expression() else {
                    continue;
                };
                if member_expression_identifier_property_name(member)
                    .is_some_and(|method_name| MUTATING_ARRAY_METHOD_NAMES.contains(&method_name))
                    && let Some(name) = index_map_root_identifier_name(member.object())
                {
                    names.insert(name.to_string());
                }
            }
            _ => {}
        }
    }
    names
}

fn is_variable_declarator_binding_identifier(
    candidate: &AstNode<'_>,
    loop_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == loop_id {
            return false;
        }
        if let AstKind::VariableDeclarator(declarator) = ancestor.kind() {
            return declarator.id.span().contains_inclusive(candidate.span());
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

fn belongs_to_loop_walk<'a>(
    candidate: &AstNode<'a>,
    loop_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    if candidate.id() == loop_id {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == loop_id {
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

fn collect_identifier_names_in_span(
    span: Span,
    names: &mut FxHashSet<String>,
    ctx: &LintContext<'_>,
) {
    for candidate in ctx.nodes().iter() {
        if !span.contains_inclusive(candidate.span()) {
            continue;
        }
        let name = match candidate.kind() {
            AstKind::BindingIdentifier(identifier) => identifier.name.as_str(),
            AstKind::IdentifierName(identifier) => identifier.name.as_str(),
            AstKind::IdentifierReference(identifier) => identifier.name.as_str(),
            _ => continue,
        };
        names.insert(name.to_string());
    }
}

fn assignment_target_root_identifier_name<'a>(target: &'a AssignmentTarget<'a>) -> Option<&'a str> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => target
            .as_member_expression()
            .and_then(|member| index_map_root_identifier_name(member.object())),
    }
}

fn has_loop_bound_computed_index(
    receiver: &Expression<'_>,
    loop_bound_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = receiver;
    loop {
        let Some(member) = index_map_member_expression(current) else {
            return false;
        };
        if let MemberExpression::ComputedMemberExpression(computed) = member
            && span_references_any_name(computed.expression.span(), loop_bound_names, ctx)
        {
            return true;
        }
        current = member.object();
    }
}

fn span_references_any_name(span: Span, names: &FxHashSet<String>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::BindingIdentifier(identifier) => names.contains(identifier.name.as_str()),
            AstKind::IdentifierName(identifier) => names.contains(identifier.name.as_str()),
            AstKind::IdentifierReference(identifier) => names.contains(identifier.name.as_str()),
            _ => false,
        }
    })
}

fn index_map_root_identifier_name<'a>(mut expression: &'a Expression<'a>) -> Option<&'a str> {
    loop {
        let inner = expression.get_inner_expression();
        if let Expression::Identifier(identifier) = inner {
            return Some(identifier.name.as_str());
        }
        let member = index_map_member_expression(inner)?;
        expression = member.object();
    }
}

fn index_map_member_expression<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a MemberExpression<'a>> {
    let inner = expression.get_inner_expression();
    if let Some(member) = inner.as_member_expression() {
        return Some(member);
    }
    let Expression::ChainExpression(chain) = inner else {
        return None;
    };
    chain.expression.as_member_expression()
}
