use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind as WebAnimationAstKind,
    ast::{ArrayExpressionElement, Expression as WebAnimationExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

#[derive(Debug, Default, Clone)]
pub struct WebAnimationOffsetsValid;
declare_oxc_lint!(
    /// Validates Web Animation keyframe offsets.
    WebAnimationOffsetsValid,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Web Animation keyframe offsets."
);

impl Rule for WebAnimationOffsetsValid {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let WebAnimationAstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return;
        };
        if member.static_property_name() != Some("animate")
            || !web_animation_is_dom_receiver(member.object(), ctx)
        {
            return;
        }
        let Some(keyframes) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(offsets) = web_animation_offsets(keyframes) else {
            return;
        };
        let mut previous = None;
        for (expression, value) in offsets {
            if !(0.0..=1.0).contains(&value) {
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "This Web Animation offset is {}, but offsets must be between 0 and 1.",
                        format_javascript_number(value)
                    ))
                    .with_label(expression.span()),
                );
                previous = None;
            } else {
                if let Some(previous) = previous
                    && value < previous
                {
                    ctx.diagnostic(OxcDiagnostic::error(format!("This Web Animation offset moves backward from {} to {}. Keep offsets in nondecreasing order.", format_javascript_number(previous), format_javascript_number(value))).with_label(expression.span()));
                }
                previous = Some(value);
            }
        }
    }
}

fn web_animation_offsets<'a>(
    expression: &'a WebAnimationExpression<'a>,
) -> Option<Vec<(&'a WebAnimationExpression<'a>, f64)>> {
    match expression.get_inner_expression() {
        WebAnimationExpression::ArrayExpression(array) => {
            let mut offsets = Vec::new();
            for element in &array.elements {
                let ArrayExpressionElement::ObjectExpression(object) = element else {
                    return None;
                };
                if object
                    .properties
                    .iter()
                    .any(|property| !matches!(property, ObjectPropertyKind::ObjectProperty(_)))
                {
                    return None;
                }
                if let Some(value) = web_animation_effective_property(object, "offset") {
                    if matches!(
                        value.get_inner_expression(),
                        WebAnimationExpression::NullLiteral(_)
                    ) {
                        continue;
                    }
                    let value = value.get_inner_expression();
                    offsets.push((value, web_animation_static_number(value)?));
                }
            }
            Some(offsets)
        }
        WebAnimationExpression::ObjectExpression(object) => {
            if object
                .properties
                .iter()
                .any(|property| !matches!(property, ObjectPropertyKind::ObjectProperty(_)))
            {
                return None;
            }
            let WebAnimationExpression::ArrayExpression(array) =
                web_animation_effective_property(object, "offset")?.get_inner_expression()
            else {
                return None;
            };
            let mut offsets = Vec::new();
            for element in &array.elements {
                match element {
                    ArrayExpressionElement::Elision(_) => continue,
                    ArrayExpressionElement::SpreadElement(_) => return None,
                    _ => {}
                }
                let value = element.as_expression()?;
                if matches!(
                    value.get_inner_expression(),
                    WebAnimationExpression::NullLiteral(_)
                ) {
                    continue;
                }
                let value = value.get_inner_expression();
                offsets.push((value, web_animation_static_number(value)?));
            }
            Some(offsets)
        }
        _ => None,
    }
}

fn web_animation_effective_property<'a>(
    object: &'a oxc_ast::ast::ObjectExpression<'a>,
    name: &str,
) -> Option<&'a WebAnimationExpression<'a>> {
    let mut result = None;
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            result = None;
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            result = None;
            continue;
        };
        if property_name == name {
            result = Some(&property.value);
        }
    }
    result
}

fn web_animation_static_number(expression: &WebAnimationExpression<'_>) -> Option<f64> {
    match expression.get_inner_expression() {
        WebAnimationExpression::NumericLiteral(number) => Some(number.value),
        WebAnimationExpression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            match unary.argument.get_inner_expression() {
                WebAnimationExpression::NumericLiteral(number) => Some(-number.value),
                _ => None,
            }
        }
        _ => None,
    }
}

fn web_animation_is_dom_receiver<'a>(
    expression: &WebAnimationExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    web_animation_is_dom_receiver_inner(expression, ctx, &mut Vec::new())
}

fn web_animation_is_dom_receiver_inner<'a>(
    expression: &WebAnimationExpression<'a>,
    ctx: &LintContext<'a>,
    visited_wrapper_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if web_animation_has_asserted_dom_target_type(expression, ctx)
        || is_proven_dom_event_target(expression, ctx, &mut Vec::new())
    {
        return true;
    }
    let WebAnimationExpression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let WebAnimationExpression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_wrapper_symbols.contains(&symbol_id) {
        return false;
    }
    visited_wrapper_symbols.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let matches = match declaration.kind() {
        WebAnimationAstKind::Function(function)
            if !function.r#async
                && !function.generator
                && ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .all(|reference| !reference.is_write()) =>
        {
            function.body.as_ref().is_some_and(|body| {
                web_animation_function_body_returns_dom_receiver(
                    function.node_id.get(),
                    &body.statements,
                    ctx,
                    visited_wrapper_symbols,
                )
            })
        }
        WebAnimationAstKind::VariableDeclarator(declarator) if matches!(ctx.nodes().parent_node(declaration.id()).kind(), WebAnimationAstKind::VariableDeclaration(variable) if variable.kind.is_const()) =>
        {
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            match initializer.get_inner_expression() {
                WebAnimationExpression::ArrowFunctionExpression(function) if !function.r#async => {
                    if let Some(returned) = function.get_expression() {
                        let mut returned_visited_symbols = visited_wrapper_symbols.clone();
                        web_animation_is_dom_receiver_inner(
                            returned,
                            ctx,
                            &mut returned_visited_symbols,
                        )
                    } else {
                        function.body.as_function_body().is_some_and(|body| {
                            web_animation_function_body_returns_dom_receiver(
                                function.node_id.get(),
                                &body.statements,
                                ctx,
                                visited_wrapper_symbols,
                            )
                        })
                    }
                }
                WebAnimationExpression::FunctionExpression(function)
                    if !function.r#async && !function.generator =>
                {
                    function.body.as_ref().is_some_and(|body| {
                        web_animation_function_body_returns_dom_receiver(
                            function.node_id.get(),
                            &body.statements,
                            ctx,
                            visited_wrapper_symbols,
                        )
                    })
                }
                _ => false,
            }
        }
        _ => false,
    };
    visited_wrapper_symbols.pop();
    matches
}

fn web_animation_function_body_returns_dom_receiver<'a>(
    function_node_id: oxc_semantic::NodeId,
    statements: &[oxc_ast::ast::Statement<'a>],
    ctx: &LintContext<'a>,
    visited_wrapper_symbols: &[oxc_semantic::SymbolId],
) -> bool {
    if !statements
        .iter()
        .any(|statement| statement_always_exits(statement))
    {
        return false;
    }
    let mut did_find_return = false;
    for candidate in ctx.nodes().iter() {
        let WebAnimationAstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if ctx.nodes().ancestors(candidate.id()).find_map(|ancestor| {
            matches!(
                ancestor.kind(),
                WebAnimationAstKind::Function(_) | WebAnimationAstKind::ArrowFunctionExpression(_)
            )
            .then_some(ancestor.id())
        }) != Some(function_node_id)
        {
            continue;
        }
        let Some(returned) = return_statement.argument.as_ref() else {
            return false;
        };
        did_find_return = true;
        let mut returned_visited_symbols = visited_wrapper_symbols.to_vec();
        if !web_animation_is_dom_receiver_inner(returned, ctx, &mut returned_visited_symbols) {
            return false;
        }
    }
    did_find_return
}

fn web_animation_has_asserted_dom_target_type<'a>(
    expression: &WebAnimationExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut wrapper = expression;
    let mut did_find_target_assertion = false;
    loop {
        let (inner, type_annotation) = match wrapper {
            WebAnimationExpression::TSAsExpression(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            WebAnimationExpression::TSTypeAssertion(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            WebAnimationExpression::TSSatisfiesExpression(assertion) => {
                (&assertion.expression, &assertion.type_annotation)
            }
            _ => break,
        };
        if is_dom_event_target_type(type_annotation, ctx) {
            did_find_target_assertion = true;
        } else if did_find_target_assertion {
            return false;
        }
        wrapper = inner;
    }
    if !did_find_target_assertion {
        return false;
    }
    let mut asserted_source = web_animation_strip_parentheses(wrapper);
    if let WebAnimationExpression::Identifier(identifier) = asserted_source {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        let declaration = ctx.symbol_declaration(symbol_id);
        let WebAnimationAstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
            || !matches!(ctx.nodes().parent_node(declaration.id()).kind(), WebAnimationAstKind::VariableDeclaration(variable) if variable.kind.is_const())
        {
            return false;
        }
        let Some(initializer) = declarator.init.as_ref() else {
            return false;
        };
        asserted_source = web_animation_strip_parentheses(initializer);
    }
    if matches!(
        asserted_source,
        WebAnimationExpression::Identifier(_)
            | WebAnimationExpression::StaticMemberExpression(_)
            | WebAnimationExpression::ComputedMemberExpression(_)
            | WebAnimationExpression::PrivateFieldExpression(_)
            | WebAnimationExpression::ObjectExpression(_)
    ) {
        return false;
    }
    match asserted_source {
        WebAnimationExpression::NewExpression(new_expression) => {
            is_global_dom_event_target_constructor(&new_expression.callee, ctx, &mut Vec::new())
        }
        _ => true,
    }
}

fn web_animation_strip_parentheses<'a, 'b>(
    mut expression: &'b WebAnimationExpression<'a>,
) -> &'b WebAnimationExpression<'a> {
    while let WebAnimationExpression::ParenthesizedExpression(parenthesized) = expression {
        expression = &parenthesized.expression;
    }
    expression
}
