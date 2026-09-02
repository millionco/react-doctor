use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeName, JSXAttributeValue, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NAMED_HANDLER_MESSAGE: &str = "Your users get janky scrolling when setState in this onScroll handler redraws the screen on every scroll event.";
const INLINE_HANDLER_MESSAGE: &str = "Your users get janky scrolling when setState in onScroll redraws the screen on every scroll event.";

#[derive(Debug, Default, Clone)]
pub struct RnNoScrollState;

struct RnScrollNodeIndex {
    call_node_ids_by_start: Vec<NodeId>,
    identifier_node_ids_by_start: Vec<NodeId>,
    rule_candidate_node_ids: Vec<NodeId>,
}

impl RnScrollNodeIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut call_node_ids_by_start = Vec::new();
        let mut identifier_node_ids_by_start = Vec::new();
        let mut rule_candidate_node_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(_) => call_node_ids_by_start.push(node.id()),
                AstKind::BindingIdentifier(_)
                | AstKind::IdentifierName(_)
                | AstKind::IdentifierReference(_) => {
                    identifier_node_ids_by_start.push(node.id());
                }
                AstKind::VariableDeclarator(_) | AstKind::JSXAttribute(_) => {
                    rule_candidate_node_ids.push(node.id());
                }
                _ => {}
            }
        }
        call_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        identifier_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self {
            call_node_ids_by_start,
            identifier_node_ids_by_start,
            rule_candidate_node_ids,
        }
    }
}

declare_oxc_lint!(
    /// Disallow React state updates in React Native scroll handlers.
    RnNoScrollState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React state updates in React Native scroll handlers.",
);

impl Rule for RnNoScrollState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = RnScrollNodeIndex::new(ctx);
        let mut state_setters_in_handlers = FxHashMap::default();
        for node_id in &node_index.rule_candidate_node_ids {
            let node = ctx.nodes().get_node(*node_id);
            match node.kind() {
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(handler_identifier) = &declarator.id
                    else {
                        continue;
                    };
                    if !handler_identifier
                        .name
                        .to_ascii_lowercase()
                        .contains("scroll")
                    {
                        continue;
                    }
                    let Some(handler_boundary) = declarator
                        .init
                        .as_ref()
                        .and_then(rn_scroll_handler_body_span)
                    else {
                        continue;
                    };
                    if let Some(setter_span) =
                        rn_scroll_find_set_state_in_body(handler_boundary, &node_index, ctx)
                    {
                        state_setters_in_handlers
                            .insert(handler_identifier.name.as_str(), setter_span);
                    }
                }
                AstKind::JSXAttribute(attribute) => {
                    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                        continue;
                    };
                    if attribute_name.name != "onScroll" {
                        continue;
                    }
                    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                    else {
                        continue;
                    };
                    let Some(expression) = container.expression.as_expression() else {
                        continue;
                    };
                    if let Expression::Identifier(handler_identifier) = expression {
                        if let Some(setter_span) =
                            state_setters_in_handlers.get(handler_identifier.name.as_str())
                        {
                            ctx.diagnostic(
                                OxcDiagnostic::error(NAMED_HANDLER_MESSAGE)
                                    .with_label(*setter_span),
                            );
                        }
                        continue;
                    }
                    let Some(handler_boundary) = rn_scroll_handler_body_span(expression) else {
                        continue;
                    };
                    if let Some(setter_span) =
                        rn_scroll_find_set_state_in_body(handler_boundary, &node_index, ctx)
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::error(INLINE_HANDLER_MESSAGE).with_label(setter_span),
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn rn_scroll_handler_body_span(expression: &Expression<'_>) -> Option<Span> {
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(
            function
                .get_expression()
                .map_or(function.body.span(), GetSpan::span),
        ),
        Expression::FunctionExpression(function) => function.body.as_ref().map(|body| body.span),
        _ => None,
    }
}

fn rn_scroll_find_set_state_in_body(
    boundary: Span,
    node_index: &RnScrollNodeIndex,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    rn_scroll_node_ids_in_span(&node_index.call_node_ids_by_start, boundary, ctx)
        .filter_map(|candidate| {
            let candidate = ctx.nodes().get_node(candidate);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            let Expression::Identifier(setter_identifier) = &call_expression.callee else {
                return None;
            };
            let setter_name = setter_identifier.name.as_str();
            if !rn_scroll_is_set_state_name(setter_name)
                || !rn_scroll_is_use_state_setter_in_scope(candidate, setter_name, ctx)
                || rn_scroll_is_guarded_set_once_latch(
                    candidate,
                    setter_name,
                    boundary,
                    node_index,
                    ctx,
                )
            {
                return None;
            }
            Some(call_expression.span)
        })
        .next()
}

fn rn_scroll_is_set_state_name(name: &str) -> bool {
    name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn rn_scroll_is_use_state_setter_in_scope(
    call_node: &AstNode<'_>,
    setter_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(call_node.id())
        .any(|ancestor| match ancestor.kind() {
            AstKind::BlockStatement(block) => {
                rn_scroll_statements_have_use_state_setter(&block.body, setter_name)
            }
            AstKind::FunctionBody(body) => {
                rn_scroll_statements_have_use_state_setter(&body.statements, setter_name)
            }
            AstKind::Program(program) => {
                rn_scroll_statements_have_use_state_setter(&program.body, setter_name)
            }
            _ => false,
        })
}

fn rn_scroll_statements_have_use_state_setter(
    statements: &[Statement<'_>],
    setter_name: &str,
) -> bool {
    statements.iter().any(|statement| {
        let Statement::VariableDeclaration(declaration) = statement else {
            return false;
        };
        declaration.declarations.iter().any(|declarator| {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            let Some(BindingPattern::BindingIdentifier(setter_identifier)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                return false;
            };
            let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
                return false;
            };
            setter_identifier.name == setter_name
                && rn_scroll_callee_name(&hook_call.callee) == Some("useState")
        })
    })
}

fn rn_scroll_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    }
}

fn rn_scroll_is_guarded_set_once_latch(
    call_node: &AstNode<'_>,
    setter_name: &str,
    boundary: Span,
    node_index: &RnScrollNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    let Some(first_argument) = call_expression
        .arguments
        .first()
        .and_then(|argument| argument.as_expression())
    else {
        return false;
    };
    if !matches!(
        first_argument,
        Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::NullLiteral(_)
    ) {
        return false;
    }
    let Some(state_name) = rn_scroll_setter_to_state_name(setter_name) else {
        return false;
    };
    let latch_ref_name = format!("{state_name}Ref");
    let mut containing_branch_span = call_node.span();
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if ancestor.span() == boundary {
            break;
        }
        let guard_result = match ancestor.kind() {
            AstKind::IfStatement(statement)
                if rn_scroll_test_reads_name(&statement.test, &state_name, node_index, ctx)
                    || rn_scroll_test_reads_name(
                        &statement.test,
                        &latch_ref_name,
                        node_index,
                        ctx,
                    ) =>
            {
                let is_alternate = statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == containing_branch_span);
                let sibling = if is_alternate {
                    Some(&statement.consequent)
                } else {
                    statement.alternate.as_ref()
                };
                Some(sibling.is_some_and(|branch| {
                    rn_scroll_branch_calls_setter(branch.span(), setter_name, node_index, ctx)
                }))
            }
            AstKind::ConditionalExpression(expression)
                if rn_scroll_test_reads_name(&expression.test, &state_name, node_index, ctx)
                    || rn_scroll_test_reads_name(
                        &expression.test,
                        &latch_ref_name,
                        node_index,
                        ctx,
                    ) =>
            {
                let sibling = if expression.alternate.span() == containing_branch_span {
                    &expression.consequent
                } else {
                    &expression.alternate
                };
                Some(rn_scroll_branch_calls_setter(
                    sibling.span(),
                    setter_name,
                    node_index,
                    ctx,
                ))
            }
            _ => None,
        };
        if let Some(sibling_calls_setter) = guard_result {
            return !sibling_calls_setter;
        }
        containing_branch_span = ancestor.span();
    }
    false
}

fn rn_scroll_setter_to_state_name(setter_name: &str) -> Option<String> {
    let state_suffix = setter_name.strip_prefix("set")?;
    let mut characters = state_suffix.chars();
    let first_character = characters.next()?;
    Some(first_character.to_ascii_lowercase().to_string() + characters.as_str())
}

fn rn_scroll_test_reads_name(
    test: &Expression<'_>,
    name: &str,
    node_index: &RnScrollNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    rn_scroll_node_ids_in_span(&node_index.identifier_node_ids_by_start, test.span(), ctx).any(
        |candidate| match ctx.nodes().get_node(candidate).kind() {
            AstKind::BindingIdentifier(identifier) => identifier.name == name,
            AstKind::IdentifierName(identifier) => identifier.name == name,
            AstKind::IdentifierReference(identifier) => identifier.name == name,
            _ => false,
        },
    )
}

fn rn_scroll_branch_calls_setter(
    branch: Span,
    setter_name: &str,
    node_index: &RnScrollNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    rn_scroll_node_ids_in_span(&node_index.call_node_ids_by_start, branch, ctx).any(|candidate| {
        matches!(
            ctx.nodes().get_node(candidate).kind(),
            AstKind::CallExpression(call_expression)
                if matches!(&call_expression.callee, Expression::Identifier(identifier) if identifier.name == setter_name)
        )
    })
}

fn rn_scroll_node_ids_in_span<'index, 'ast>(
    node_ids_by_start: &'index [NodeId],
    span: Span,
    ctx: &'index LintContext<'ast>,
) -> impl Iterator<Item = NodeId> + 'index {
    let first_candidate_index = node_ids_by_start
        .partition_point(|node_id| ctx.nodes().get_node(*node_id).span().start < span.start);
    node_ids_by_start[first_candidate_index..]
        .iter()
        .copied()
        .take_while(move |node_id| ctx.nodes().get_node(*node_id).span().start <= span.end)
        .filter(move |node_id| span.contains_inclusive(ctx.nodes().get_node(*node_id).span()))
}
