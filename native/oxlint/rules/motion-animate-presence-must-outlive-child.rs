use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};
const MESSAGE: &str = "This AnimatePresence boundary is removed by the same condition as its child, so it cannot observe the child leaving or run its exit animation. Keep the boundary mounted and conditionally render the child inside it.";

struct MotionPresenceAnalysis {
    exit_opening_ids: Vec<oxc_semantic::NodeId>,
    rendered_collection_callback_ids: Vec<oxc_semantic::NodeId>,
    return_statement_ids_by_function: FxHashMap<oxc_semantic::NodeId, Vec<oxc_semantic::NodeId>>,
}

#[derive(Debug, Default, Clone)]
pub struct MotionAnimatePresenceMustOutliveChild;
declare_oxc_lint!(
    /// Keeps AnimatePresence mounted while children exit.
    MotionAnimatePresenceMustOutliveChild,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Keep AnimatePresence mounted while children exit."
);
impl Rule for MotionAnimatePresenceMustOutliveChild {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = motion_presence_analysis(ctx);
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            if !motion_react_component_matches(
                &element.opening_element.name,
                "AnimatePresence",
                ctx,
            ) {
                continue;
            }
            if motion_presence_propagates(&element.opening_element)
                && ctx.nodes().ancestors(node.id()).any(|ancestor| {
                    matches!(ancestor.kind(), AstKind::JSXElement(element) if motion_react_component_matches(&element.opening_element.name, "AnimatePresence", ctx))
                })
            {
                continue;
            }
            if !motion_presence_has_exit(node, &analysis, ctx, &mut assigned_expression_cache) {
                continue;
            }
            let mut condition = None;
            for ancestor in ctx.nodes().ancestors(node.id()) {
                match ancestor.kind() {
                    AstKind::LogicalExpression(_) | AstKind::ConditionalExpression(_) => {
                        condition = Some(ancestor);
                        break;
                    }
                    AstKind::ArrowFunctionExpression(_) | AstKind::Function(_) => {
                        condition = None;
                        break;
                    }
                    _ => {}
                }
            }
            let Some(condition) = condition else { continue };
            let owned = ctx.nodes().parent_node(condition.id());
            let owned = ctx.nodes().parent_node(owned.id());
            if matches!(owned.kind(),AstKind::JSXElement(e)if motion_react_component_matches(&e.opening_element.name,"AnimatePresence",ctx))
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
        }
    }
}
fn motion_presence_propagates(open: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(a) = get_authoritative_jsx_attribute(open, "propagate", true) else {
        return false;
    };
    if a.value.is_none() {
        return true;
    }
    matches!(a.value.as_ref(),Some(JSXAttributeValue::ExpressionContainer(c))if matches!(c.expression.as_expression().map(Expression::get_inner_expression),Some(Expression::BooleanLiteral(v))if v.value))
}

fn motion_presence_analysis(ctx: &LintContext<'_>) -> MotionPresenceAnalysis {
    let mut exit_opening_ids = Vec::new();
    let mut rendered_collection_callback_ids = Vec::new();
    let mut return_statement_ids_by_function = FxHashMap::<_, Vec<_>>::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::JSXOpeningElement(opening)
                if is_proven_motion_jsx_element(&opening.name, ctx)
                    && get_authoritative_jsx_attribute(opening, "exit", true).is_some() =>
            {
                exit_opening_ids.push(node.id());
            }
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
                if motion_presence_is_rendered_collection_callback(node, ctx) =>
            {
                rendered_collection_callback_ids.push(node.id());
            }
            AstKind::ReturnStatement(_) => {
                if let Some(function_id) = ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
                    )
                    .then_some(ancestor.id())
                }) {
                    return_statement_ids_by_function
                        .entry(function_id)
                        .or_default()
                        .push(node.id());
                }
            }
            _ => {}
        }
    }
    MotionPresenceAnalysis {
        exit_opening_ids,
        rendered_collection_callback_ids,
        return_statement_ids_by_function,
    }
}

fn motion_presence_is_rendered_collection_callback<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let function_root = transparent_expression_root(function, ctx);
    let call_node = ctx.nodes().parent_node(function_root.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    call.callee
        .as_member_expression()
        .and_then(|member| member.static_property_name())
        .is_some_and(|name| name == "map" || name == "flatMap")
        && call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|argument| argument.get_inner_expression().span() == function.span())
}

fn motion_presence_has_exit<'a>(
    boundary: &AstNode<'_>,
    analysis: &MotionPresenceAnalysis,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let boundary_span = boundary.span();
    if analysis.exit_opening_ids.iter().any(|exit_id| {
        let exit_opening = ctx.nodes().get_node(*exit_id);
        boundary_span.contains_inclusive(exit_opening.span())
            && !ctx
                .nodes()
                .ancestors(*exit_id)
                .take_while(|ancestor| ancestor.id() != boundary.id())
                .any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
                    )
                })
    }) {
        return true;
    }

    analysis
        .rendered_collection_callback_ids
        .iter()
        .copied()
        .filter(|callback_id| {
            let callback = ctx.nodes().get_node(*callback_id);
            boundary_span.contains_inclusive(callback.span())
                && !ctx
                    .nodes()
                    .ancestors(*callback_id)
                    .take_while(|ancestor| ancestor.id() != boundary.id())
                    .any(|ancestor| {
                        matches!(
                            ancestor.kind(),
                            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
                        )
                    })
        })
        .any(|callback_id| {
            motion_presence_function_returns_exit(
                callback_id,
                analysis,
                ctx,
                assigned_expression_cache,
                &mut Vec::new(),
                &mut FxHashSet::default(),
            )
        })
}

fn motion_presence_function_returns_exit<'a>(
    function_id: oxc_semantic::NodeId,
    analysis: &MotionPresenceAnalysis,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_spans: &mut Vec<Span>,
    visited_function_ids: &mut FxHashSet<oxc_semantic::NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_id) {
        return false;
    }
    let function = ctx.nodes().get_node(function_id);
    let matches = match function.kind() {
        AstKind::ArrowFunctionExpression(arrow) if arrow.get_expression().is_some() => {
            arrow.get_expression().is_some_and(|expression| {
                motion_presence_returned_expression_has_exit(
                    expression,
                    analysis,
                    ctx,
                    assigned_expression_cache,
                    visited_expression_spans,
                    visited_function_ids,
                )
            })
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => analysis
            .return_statement_ids_by_function
            .get(&function_id)
            .is_some_and(|return_statement_ids| {
                return_statement_ids.iter().any(|return_statement_id| {
                    matches!(
                        ctx.nodes().get_node(*return_statement_id).kind(),
                        AstKind::ReturnStatement(statement)
                            if statement.argument.as_ref().is_some_and(|expression| {
                                motion_presence_returned_expression_has_exit(
                                    expression,
                                    analysis,
                                    ctx,
                                    assigned_expression_cache,
                                    visited_expression_spans,
                                    visited_function_ids,
                                )
                            })
                    )
                })
            }),
        _ => false,
    };
    visited_function_ids.remove(&function_id);
    matches
}

fn motion_presence_returned_expression_has_exit<'a>(
    expression: &Expression<'a>,
    analysis: &MotionPresenceAnalysis,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_spans: &mut Vec<Span>,
    visited_function_ids: &mut FxHashSet<oxc_semantic::NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let expression_span = expression.span();
    if visited_expression_spans.contains(&expression_span) {
        return false;
    }
    visited_expression_spans.push(expression_span);
    let matches = motion_presence_expression_contains_exit(expression, analysis, ctx)
        || match expression {
            Expression::Identifier(identifier) => ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    r3f_analyzed_possible_assigned_expressions(
                        identifier,
                        symbol_id,
                        ctx,
                        assigned_expression_cache,
                    )
                    .into_iter()
                    .any(|assigned_expression| {
                        !matches!(
                            assigned_expression.get_inner_expression(),
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        ) && motion_presence_returned_expression_has_exit(
                            assigned_expression,
                            analysis,
                            ctx,
                            assigned_expression_cache,
                            visited_expression_spans,
                            visited_function_ids,
                        )
                    })
                }),
            Expression::CallExpression(call) if call.arguments.is_empty() => {
                r3f_analyzed_zero_argument_helper_id(&call.callee, ctx).is_some_and(|function_id| {
                    motion_presence_function_returns_exit(
                        function_id,
                        analysis,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_spans,
                        visited_function_ids,
                    )
                })
            }
            Expression::ConditionalExpression(conditional) => {
                motion_presence_returned_expression_has_exit(
                    &conditional.consequent,
                    analysis,
                    ctx,
                    assigned_expression_cache,
                    visited_expression_spans,
                    visited_function_ids,
                ) || motion_presence_returned_expression_has_exit(
                    &conditional.alternate,
                    analysis,
                    ctx,
                    assigned_expression_cache,
                    visited_expression_spans,
                    visited_function_ids,
                )
            }
            Expression::LogicalExpression(logical) => {
                motion_presence_returned_expression_has_exit(
                    &logical.left,
                    analysis,
                    ctx,
                    assigned_expression_cache,
                    visited_expression_spans,
                    visited_function_ids,
                ) || motion_presence_returned_expression_has_exit(
                    &logical.right,
                    analysis,
                    ctx,
                    assigned_expression_cache,
                    visited_expression_spans,
                    visited_function_ids,
                )
            }
            _ => false,
        };
    visited_expression_spans.pop();
    matches
}

fn motion_presence_expression_contains_exit(
    expression: &Expression<'_>,
    analysis: &MotionPresenceAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let expression_span = expression.span();
    analysis.exit_opening_ids.iter().any(|exit_id| {
        let exit_opening = ctx.nodes().get_node(*exit_id);
        if !expression_span.contains_inclusive(exit_opening.span()) {
            return false;
        }
        for ancestor in ctx.nodes().ancestors(*exit_id) {
            if ancestor.span() == expression_span {
                return true;
            }
            if matches!(
                ancestor.kind(),
                AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
            ) {
                return false;
            }
        }
        false
    })
}
