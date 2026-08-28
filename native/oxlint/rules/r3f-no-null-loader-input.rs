use oxc_ast::{
    ast::{Argument, ArrayExpressionElement, Expression, ObjectPropertyKind},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_NULL_LOADER_FIBER_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_NULL_LOADER_DREI_MODULES: [&str; 2] = ["@react-three/drei", "@react-three/drei/native"];
const R3F_NULL_LOADER_DREI_HOOK_NAMES: [&str; 6] = [
    "useCubeTexture",
    "useFBX",
    "useFont",
    "useGLTF",
    "useKTX2",
    "useTexture",
];
const R3F_NULL_LOADER_MESSAGE: &str = "This loader input can be null or undefined, but R3F and Drei loader hooks forward asset identifiers to Three.js loaders instead of treating nullish values as a skip signal. Render the loading component conditionally";

#[derive(Debug, Default, Clone)]
pub struct R3FNoNullLoaderInput;

impl RuleMeta for R3FNoNullLoaderInput {
    const NAME: &'static str = "r3f-no-null-loader-input";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow nullish R3F loader inputs.",
    };
}

impl Rule for R3FNoNullLoaderInput {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(loader_input) = r3f_null_loader_input(call_expression, &analysis, ctx) else {
                continue;
            };
            if r3f_null_loader_has_reachable_nullish_value(loader_input, ctx, &mut Vec::new()) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(R3F_NULL_LOADER_MESSAGE).with_label(loader_input.span()),
                );
            }
        }
    }
}

fn r3f_null_loader_input<'a, 'b>(
    call_expression: &'b oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'b Expression<'a>> {
    let input_index = if r3f_null_loader_api_reference_matches(
        &call_expression.callee,
        "useLoader",
        &R3F_NULL_LOADER_FIBER_MODULES,
        analysis,
        ctx,
    ) {
        1
    } else if R3F_NULL_LOADER_DREI_HOOK_NAMES.iter().any(|hook_name| {
        r3f_null_loader_api_reference_matches(
            &call_expression.callee,
            hook_name,
            &R3F_NULL_LOADER_DREI_MODULES,
            analysis,
            ctx,
        )
    }) {
        0
    } else {
        return None;
    };
    call_expression
        .arguments
        .get(input_index)
        .and_then(Argument::as_expression)
}

fn r3f_null_loader_api_reference_matches<'a>(
    expression: &Expression<'a>,
    api_name: &str,
    module_sources: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(expression, api_name, module_sources, analysis, ctx)
        || type_import_module_api_reference_matches(
            expression,
            api_name,
            module_sources,
            analysis,
            ctx,
        )
}

fn r3f_null_loader_has_reachable_nullish_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if matches!(expression, Expression::ChainExpression(_)) {
        return true;
    }
    let candidate = expression.get_inner_expression();
    if matches!(candidate, Expression::ChainExpression(_)) {
        return true;
    }
    if r3f_null_loader_is_direct_nullish(candidate, ctx) {
        return true;
    }
    if matches!(candidate, Expression::CallExpression(call_expression) if call_expression.optional)
        || candidate
            .as_member_expression()
            .is_some_and(|member_expression| member_expression.optional())
    {
        return true;
    }
    match candidate {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            let Some(initializer) = r3f_null_loader_const_initializer(symbol_id, ctx) else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            r3f_null_loader_has_reachable_nullish_value(initializer, ctx, visited_symbol_ids)
        }
        Expression::ConditionalExpression(conditional_expression) => {
            match r3f_null_loader_static_truthiness(
                &conditional_expression.test,
                ctx,
                &mut Vec::new(),
            ) {
                Some(true) => r3f_null_loader_has_reachable_nullish_value(
                    &conditional_expression.consequent,
                    ctx,
                    visited_symbol_ids,
                ),
                Some(false) => r3f_null_loader_has_reachable_nullish_value(
                    &conditional_expression.alternate,
                    ctx,
                    visited_symbol_ids,
                ),
                None => {
                    r3f_null_loader_has_reachable_nullish_value(
                        &conditional_expression.consequent,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ) || r3f_null_loader_has_reachable_nullish_value(
                        &conditional_expression.alternate,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                }
            }
        }
        Expression::LogicalExpression(logical_expression) => {
            let left_truthiness =
                r3f_null_loader_static_truthiness(&logical_expression.left, ctx, &mut Vec::new());
            match logical_expression.operator {
                LogicalOperator::And if left_truthiness == Some(false) => {
                    r3f_null_loader_has_reachable_nullish_value(
                        &logical_expression.left,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                LogicalOperator::And if left_truthiness == Some(true) => {
                    r3f_null_loader_has_reachable_nullish_value(
                        &logical_expression.right,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                LogicalOperator::And => {
                    r3f_null_loader_has_reachable_nullish_value(
                        &logical_expression.left,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ) || r3f_null_loader_has_reachable_nullish_value(
                        &logical_expression.right,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                }
                LogicalOperator::Or if left_truthiness == Some(true) => false,
                LogicalOperator::Or => r3f_null_loader_has_reachable_nullish_value(
                    &logical_expression.right,
                    ctx,
                    visited_symbol_ids,
                ),
                LogicalOperator::Coalesce => {
                    if left_truthiness.is_some()
                        && !r3f_null_loader_has_reachable_nullish_value(
                            &logical_expression.left,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        )
                    {
                        return false;
                    }
                    r3f_null_loader_has_reachable_nullish_value(
                        &logical_expression.right,
                        ctx,
                        visited_symbol_ids,
                    )
                }
            }
        }
        Expression::ArrayExpression(array_expression) => {
            array_expression
                .elements
                .iter()
                .any(|element| match element {
                    ArrayExpressionElement::Elision(_) => true,
                    ArrayExpressionElement::SpreadElement(_) => false,
                    element => ArrayExpressionElement::as_expression(element).is_some_and(
                        |element_expression| {
                            r3f_null_loader_has_reachable_nullish_value(
                                element_expression,
                                ctx,
                                &mut visited_symbol_ids.clone(),
                            )
                        },
                    ),
                })
        }
        Expression::ObjectExpression(object_expression) => {
            object_expression.properties.iter().any(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return false;
                };
                r3f_null_loader_has_reachable_nullish_value(
                    &property.value,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            })
        }
        _ => false,
    }
}

fn r3f_null_loader_static_truthiness<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<bool> {
    let candidate = expression.get_inner_expression();
    if let Some(truthiness) = static_literal_truthiness(candidate) {
        return Some(truthiness);
    }
    match candidate {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if identifier.name == "undefined" && symbol_id.is_none() {
                return Some(false);
            }
            let symbol_id = symbol_id?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            let initializer = r3f_null_loader_const_initializer(symbol_id, ctx)?;
            visited_symbol_ids.push(symbol_id);
            r3f_null_loader_static_truthiness(initializer, ctx, visited_symbol_ids)
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::Void =>
        {
            Some(false)
        }
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::LogicalNot =>
        {
            r3f_null_loader_static_truthiness(
                &unary_expression.argument,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
            .map(|truthiness| !truthiness)
        }
        Expression::ConditionalExpression(conditional_expression) => {
            if let Some(test_truthiness) = r3f_null_loader_static_truthiness(
                &conditional_expression.test,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) {
                return r3f_null_loader_static_truthiness(
                    if test_truthiness {
                        &conditional_expression.consequent
                    } else {
                        &conditional_expression.alternate
                    },
                    ctx,
                    &mut visited_symbol_ids.clone(),
                );
            }
            let consequent_truthiness = r3f_null_loader_static_truthiness(
                &conditional_expression.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            let alternate_truthiness = r3f_null_loader_static_truthiness(
                &conditional_expression.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            if consequent_truthiness.is_some() && consequent_truthiness == alternate_truthiness {
                consequent_truthiness
            } else {
                None
            }
        }
        Expression::LogicalExpression(logical_expression) => {
            let left_truthiness = r3f_null_loader_static_truthiness(
                &logical_expression.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            if logical_expression.operator == LogicalOperator::And && left_truthiness == Some(false)
            {
                return Some(false);
            }
            if logical_expression.operator == LogicalOperator::Or && left_truthiness == Some(true) {
                return Some(true);
            }
            if !matches!(
                logical_expression.operator,
                LogicalOperator::And | LogicalOperator::Or
            ) {
                return None;
            }
            let right_truthiness = r3f_null_loader_static_truthiness(
                &logical_expression.right,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            if left_truthiness.is_some() {
                return right_truthiness;
            }
            if logical_expression.operator == LogicalOperator::And
                && right_truthiness == Some(false)
            {
                return Some(false);
            }
            if logical_expression.operator == LogicalOperator::Or && right_truthiness == Some(true)
            {
                return Some(true);
            }
            None
        }
        Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::NewExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_) => Some(true),
        _ => None,
    }
}

fn r3f_null_loader_is_direct_nullish(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        Expression::UnaryExpression(unary_expression) => {
            unary_expression.operator == UnaryOperator::Void
        }
        _ => false,
    }
}

fn r3f_null_loader_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if !variable_declaration.kind.is_const()
        || !declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}
