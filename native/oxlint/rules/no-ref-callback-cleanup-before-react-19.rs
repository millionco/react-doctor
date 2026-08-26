use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_syntax::operator::LogicalOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This ref callback returns a cleanup function, but React 18 ignores ref cleanup returns, so the cleanup never runs. Handle detachment when React calls the ref with `null`, or require React 19.";

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct NoRefCallbackCleanupBeforeReact_19;

pub type NoRefCallbackCleanupBeforeReact19 = NoRefCallbackCleanupBeforeReact_19;

declare_oxc_lint!(
    /// Disallow cleanup functions returned from ref callbacks before React 19.
    NoRefCallbackCleanupBeforeReact_19,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ref callback cleanup functions before React 19.",
);

impl Rule for NoRefCallbackCleanupBeforeReact_19 {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        if !matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name == "ref"
        ) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref()
        else {
            return;
        };
        let Some(callback) = container.expression.as_expression() else {
            return;
        };
        if !no_ref_callback_returns_cleanup(callback, ctx) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
    }
}

fn no_ref_callback_returns_cleanup<'a>(callback: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let mut visited_symbol_ids = Vec::new();
    no_ref_resolve_function_expressions(callback, ctx, &mut visited_symbol_ids)
        .into_iter()
        .any(|function_id| no_ref_function_returns_cleanup(function_id, ctx))
}

fn no_ref_resolve_function_expressions<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Vec<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            if function.r#async {
                Vec::new()
            } else {
                vec![function.node_id.get()]
            }
        }
        Expression::FunctionExpression(function) => {
            if function.r#async || function.generator {
                Vec::new()
            } else {
                vec![function.node_id.get()]
            }
        }
        Expression::ConditionalExpression(conditional) => {
            if let Some(test_truthiness) = static_literal_truthiness(&conditional.test) {
                let selected_branch = if test_truthiness {
                    &conditional.consequent
                } else {
                    &conditional.alternate
                };
                return no_ref_resolve_function_expressions(
                    selected_branch,
                    ctx,
                    visited_symbol_ids,
                );
            }
            let mut functions = no_ref_resolve_function_expressions(
                &conditional.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            functions.extend(no_ref_resolve_function_expressions(
                &conditional.alternate,
                ctx,
                visited_symbol_ids,
            ));
            functions
        }
        Expression::LogicalExpression(logical) => {
            if let Some(left_truthiness) = static_literal_truthiness(&logical.left) {
                if (logical.operator == LogicalOperator::And && !left_truthiness)
                    || (logical.operator == LogicalOperator::Or && left_truthiness)
                    || (logical.operator == LogicalOperator::Coalesce
                        && !matches!(
                            logical.left.get_inner_expression(),
                            Expression::NullLiteral(_)
                        ))
                {
                    return Vec::new();
                }
            }
            if logical.operator == LogicalOperator::And {
                return no_ref_resolve_function_expressions(
                    &logical.right,
                    ctx,
                    visited_symbol_ids,
                );
            }
            let mut functions = no_ref_resolve_function_expressions(
                &logical.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            functions.extend(no_ref_resolve_function_expressions(
                &logical.right,
                ctx,
                visited_symbol_ids,
            ));
            functions
        }
        Expression::SequenceExpression(sequence) => {
            sequence
                .expressions
                .last()
                .map_or_else(Vec::new, |last_expression| {
                    no_ref_resolve_function_expressions(last_expression, ctx, visited_symbol_ids)
                })
        }
        Expression::CallExpression(call) if is_react_api_call(call, "useCallback", ctx) => call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map_or_else(Vec::new, |callback| {
                no_ref_resolve_function_expressions(callback, ctx, visited_symbol_ids)
            }),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return Vec::new();
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return Vec::new();
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::Function(function) = declaration.kind() {
                if function.r#async
                    || function.generator
                    || ctx
                        .scoping()
                        .get_resolved_references(symbol_id)
                        .any(oxc_semantic::Reference::is_write)
                {
                    return Vec::new();
                }
                return vec![declaration.id()];
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Vec::new();
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(
                parent.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return Vec::new();
            }
            declarator
                .init
                .as_ref()
                .map_or_else(Vec::new, |initializer| {
                    no_ref_resolve_function_expressions(initializer, ctx, visited_symbol_ids)
                })
        }
        _ => Vec::new(),
    }
}

fn no_ref_function_returns_cleanup(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression_body) = function.get_expression()
    {
        return !function.r#async
            && !no_ref_resolve_function_expressions(expression_body, ctx, &mut Vec::new())
                .is_empty();
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        crate::ast_util::get_enclosing_function(candidate, ctx)
            .is_some_and(|owner| owner.id() == function_id)
            && return_statement
                .argument
                .as_ref()
                .is_some_and(|return_value| {
                    !no_ref_resolve_function_expressions(return_value, ctx, &mut Vec::new())
                        .is_empty()
                })
    })
}
