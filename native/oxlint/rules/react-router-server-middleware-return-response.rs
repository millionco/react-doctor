use oxc_ast::{AstKind, ast::Expression};
use oxc_cfg::{EdgeType, ErrorEdgeKind, InstructionKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Server middleware discards the Response returned by next().";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterServerMiddlewareReturnResponse;

declare_oxc_lint!(
    /// Requires React Router server middleware to return a response after calling next.
    ReactRouterServerMiddlewareReturnResponse,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require server middleware to return a response.",
);

impl Rule for ReactRouterServerMiddlewareReturnResponse {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_framework_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(next_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(next_callee) = &next_call.callee else {
            return;
        };
        let Some(middleware_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(next_symbol_id) =
            get_react_router_middleware_next_symbol(middleware_function, ctx)
        else {
            return;
        };
        if ctx
            .scoping()
            .get_reference(next_callee.reference_id())
            .symbol_id()
            != Some(next_symbol_id)
        {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let awaited_node = if matches!(parent.kind(), AstKind::AwaitExpression(_)) {
            parent
        } else {
            node
        };
        let Some(response_receipt_statement) = response_receipt_statement(awaited_node, ctx) else {
            return;
        };
        if return_nodes_cover_every_path_after_node(
            response_receipt_statement,
            middleware_function,
            ctx,
        ) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::error(MESSAGE).with_label(response_receipt_statement.span()),
        );
    }
}

fn response_receipt_statement<'a, 'ctx>(
    awaited_node: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let parent = ctx.nodes().parent_node(awaited_node.id());
    match parent.kind() {
        AstKind::ExpressionStatement(_) => Some(parent),
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == awaited_node.span()) =>
        {
            let declaration = ctx.nodes().parent_node(parent.id());
            matches!(declaration.kind(), AstKind::VariableDeclaration(_)).then_some(declaration)
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == awaited_node.span() =>
        {
            let statement = ctx.nodes().parent_node(parent.id());
            matches!(statement.kind(), AstKind::ExpressionStatement(_)).then_some(statement)
        }
        _ => None,
    }
}

fn return_nodes_cover_every_path_after_node(
    anchor_node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let anchor_block = ctx.nodes().cfg_id(anchor_node.id());
    let mut matching_blocks = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if return_statement.argument.is_none()
            || crate::ast_util::get_enclosing_function(candidate, ctx)
                .is_none_or(|owner| owner.id() != function_node.id())
        {
            continue;
        }
        let matching_block = ctx.nodes().cfg_id(candidate.id());
        if matching_block == anchor_block && candidate.span().start < anchor_node.span().start {
            continue;
        }
        matching_blocks.insert(matching_block);
    }
    if matching_blocks.contains(&anchor_block) {
        return true;
    }

    let graph = ctx.cfg().graph();
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = vec![anchor_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        let mut successor_blocks = Vec::new();
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                EdgeType::NewFunction
                    | EdgeType::Unreachable
                    | EdgeType::Error(ErrorEdgeKind::Implicit)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if !matching_blocks.contains(&target) {
                successor_blocks.push(target);
            }
        }
        let instructions = ctx.cfg().basic_block(current_block).instructions();
        if instructions.iter().any(|instruction| {
            matches!(
                instruction.kind,
                InstructionKind::ImplicitReturn | InstructionKind::Return(_)
            )
        }) || (instructions
            .iter()
            .any(|instruction| instruction.kind == InstructionKind::Throw)
            && successor_blocks.is_empty())
        {
            return false;
        }
        pending_blocks.extend(successor_blocks);
    }
    !matching_blocks.is_empty()
}
