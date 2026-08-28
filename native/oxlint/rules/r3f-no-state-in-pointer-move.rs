use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::ContextHost,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This React state update can render on every pointer movement. Keep the preview in a ref or transient store and publish one semantic update on pointer-up";
const DISCRETE_POINTER_HIT_PROPERTY_NAMES: [&str; 3] = ["batchId", "faceIndex", "instanceId"];
const NUMERIC_QUANTIZER_NAMES: [&str; 4] = ["ceil", "floor", "round", "trunc"];

#[derive(Debug, Default, Clone)]
pub struct R3FNoStateInPointerMove;

impl RuleMeta for R3FNoStateInPointerMove {
    const NAME: &'static str = "r3f-no-state-in-pointer-move";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow React state updates inside R3F pointer-move handlers.",
    };
}

impl Rule for R3FNoStateInPointerMove {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut transition_cache = R3fStateTransitionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(handler_expression) =
                r3f_jsx_event_handler_expression(opening_element, "onPointerMove", ctx)
            else {
                continue;
            };
            let Some(handler_id) = resolve_r3f_analyzed_callback_function_id(
                handler_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(handler_id).kind(),
                AstKind::Function(function) if function.generator
            ) {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                handler_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, root_handler_id, _, _| {
                    let AstKind::CallExpression(call_expression) = candidate.kind() else {
                        return;
                    };
                    if r3f_state_cached_setter_binding(
                        candidate,
                        call_expression,
                        &analysis,
                        &mut transition_cache,
                        ctx,
                    )
                    .is_none()
                        || r3f_is_guarded_state_transition(
                            candidate,
                            root_handler_id,
                            &analysis,
                            &node_index,
                            &mut transition_cache,
                            ctx,
                        )
                        || r3f_is_bounded_pointer_bucket_update(
                            call_expression,
                            candidate,
                            root_handler_id,
                            &analysis,
                            ctx,
                        )
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

fn r3f_is_bounded_pointer_bucket_update<'a>(
    setter_call: &oxc_ast::ast::CallExpression<'a>,
    setter_node: &crate::AstNode<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    setter_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|next_state| {
            r3f_analyze_pointer_bucket_expression(
                next_state,
                setter_node,
                callback_id,
                analysis,
                ctx,
                &mut Vec::new(),
            ) == Some(true)
        })
}

fn r3f_analyze_pointer_bucket_expression<'a>(
    expression: &Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<bool> {
    if DISCRETE_POINTER_HIT_PROPERTY_NAMES
        .iter()
        .any(|property_name| {
            r3f_callback_state_property_matches(expression, callback_id, property_name, ctx)
        })
    {
        return Some(true);
    }
    match expression.get_inner_expression() {
        Expression::NumericLiteral(_) => Some(false),
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_) => None,
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
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
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            r3f_analyze_pointer_bucket_expression(
                declarator.init.as_ref()?,
                reference_node,
                callback_id,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::UnaryExpression(unary_expression)
            if matches!(
                unary_expression.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation | UnaryOperator::BitwiseNot
            ) =>
        {
            r3f_analyze_pointer_bucket_expression(
                &unary_expression.argument,
                reference_node,
                callback_id,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::BinaryExpression(binary_expression)
            if matches!(
                binary_expression.operator,
                BinaryOperator::Addition
                    | BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
                    | BinaryOperator::Remainder
                    | BinaryOperator::Exponential
                    | BinaryOperator::BitwiseOR
                    | BinaryOperator::BitwiseAnd
                    | BinaryOperator::BitwiseXOR
                    | BinaryOperator::ShiftLeft
                    | BinaryOperator::ShiftRight
                    | BinaryOperator::ShiftRightZeroFill
            ) =>
        {
            r3f_combine_pointer_bucket_analyses(
                r3f_analyze_pointer_bucket_expression(
                    &binary_expression.left,
                    reference_node,
                    callback_id,
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
                r3f_analyze_pointer_bucket_expression(
                    &binary_expression.right,
                    reference_node,
                    callback_id,
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
            )
        }
        Expression::LogicalExpression(logical_expression)
            if matches!(
                logical_expression.operator,
                LogicalOperator::Or | LogicalOperator::Coalesce
            ) =>
        {
            r3f_combine_pointer_bucket_analyses(
                r3f_analyze_pointer_bucket_expression(
                    &logical_expression.left,
                    reference_node,
                    callback_id,
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
                r3f_analyze_pointer_bucket_expression(
                    &logical_expression.right,
                    reference_node,
                    callback_id,
                    analysis,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
            )
        }
        Expression::CallExpression(call_expression) if call_expression.arguments.len() == 1 => {
            let member_expression = call_expression.callee.as_member_expression()?;
            let Expression::Identifier(receiver) =
                member_expression.object().get_inner_expression()
            else {
                return None;
            };
            if receiver.name != "Math"
                || ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_some()
                || member_expression
                    .static_property_name()
                    .is_none_or(|name| !NUMERIC_QUANTIZER_NAMES.contains(&name))
            {
                return None;
            }
            r3f_analyze_pointer_bucket_expression(
                call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)?,
                reference_node,
                callback_id,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn r3f_combine_pointer_bucket_analyses(
    left_analysis: Option<bool>,
    right_analysis: Option<bool>,
) -> Option<bool> {
    Some(left_analysis? || right_analysis?)
}
