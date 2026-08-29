use oxc_ast::{
    AstKind,
    ast::{ArrayExpression, BindingPattern, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_str::static_ident;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT: usize = 1024;

#[derive(Debug, Default, Clone)]
pub struct JsMinMaxLoop;

declare_oxc_lint!(
    /// Prefer Math.min or Math.max over sorting a fresh numeric array to read its first item.
    JsMinMaxLoop,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer Math.min or Math.max over sorting to find an extremum.",
);

impl Rule for JsMinMaxLoop {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let candidates = ctx
            .nodes()
            .iter()
            .filter_map(|node| js_min_max_candidate_target(node).map(|target| (node, target)))
            .collect::<Vec<_>>();
        let has_unsafe_min_mutation = candidates.iter().any(|(_, target)| *target == "min")
            && js_min_max_has_unsafe_builtin_mutation("min", ctx);
        let has_unsafe_max_mutation = candidates.iter().any(|(_, target)| *target == "max")
            && js_min_max_has_unsafe_builtin_mutation("max", ctx);
        for (node, target_function) in candidates {
            if js_min_max_has_unsafe_math_binding(node, ctx)
                || match target_function {
                    "min" => has_unsafe_min_mutation,
                    "max" => has_unsafe_max_mutation,
                    _ => true,
                }
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This is slow because array.sort()[0] sorts the whole list just to grab the smallest or largest, so use Math.{target_function}(...array) instead"
                ))
                .with_label(node.span()),
            );
        }
    }
}

fn js_min_max_candidate_target(node: &AstNode<'_>) -> Option<&'static str> {
    let AstKind::ComputedMemberExpression(index_member) = node.kind() else {
        return None;
    };
    if !matches!(&index_member.expression, Expression::NumericLiteral(literal) if literal.value == 0.0)
    {
        return None;
    }
    let Expression::CallExpression(sort_call) = index_member.object.get_inner_expression() else {
        return None;
    };
    let Some(sort_member) = sort_call.callee.as_member_expression() else {
        return None;
    };
    if js_min_max_identifier_property_name(sort_member) != Some("sort") {
        return None;
    }
    let Expression::ArrayExpression(array) = strip_js_min_max_parentheses(sort_member.object())
    else {
        return None;
    };
    if !js_min_max_is_safe_fresh_numeric_array(array) {
        return None;
    }
    let Some(comparator) = sort_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return None;
    };
    js_min_max_comparator_target(comparator)
}

fn js_min_max_identifier_property_name<'a>(member: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn strip_js_min_max_parentheses<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    expression.get_inner_expression()
}

fn js_min_max_comparator_target(expression: &Expression<'_>) -> Option<&'static str> {
    let (parameters, body) = match expression {
        Expression::ArrowFunctionExpression(function) if !function.r#async => {
            let body = if let Some(expression) = function.get_expression() {
                expression
            } else {
                let function_body = function.get_function_body()?;
                if !function_body.directives.is_empty() || function_body.statements.len() != 1 {
                    return None;
                }
                let oxc_ast::ast::Statement::ReturnStatement(statement) =
                    &function_body.statements[0]
                else {
                    return None;
                };
                statement.argument.as_ref()?
            };
            (function.params.items.as_slice(), body)
        }
        Expression::FunctionExpression(function) if !function.r#async && !function.generator => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let oxc_ast::ast::Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            (
                function.params.items.as_slice(),
                statement.argument.as_ref()?,
            )
        }
        _ => return None,
    };
    let [first_parameter, second_parameter] = parameters else {
        return None;
    };
    let BindingPattern::BindingIdentifier(first_identifier) = &first_parameter.pattern else {
        return None;
    };
    let BindingPattern::BindingIdentifier(second_identifier) = &second_parameter.pattern else {
        return None;
    };
    if first_identifier.name == second_identifier.name {
        return None;
    }
    let Expression::BinaryExpression(binary) = strip_js_min_max_parentheses(body) else {
        return None;
    };
    if binary.operator != BinaryOperator::Subtraction {
        return None;
    }
    let Expression::Identifier(left) = strip_js_min_max_parentheses(&binary.left) else {
        return None;
    };
    let Expression::Identifier(right) = strip_js_min_max_parentheses(&binary.right) else {
        return None;
    };
    if left.name == first_identifier.name && right.name == second_identifier.name {
        Some("min")
    } else if left.name == second_identifier.name && right.name == first_identifier.name {
        Some("max")
    } else {
        None
    }
}

fn js_min_max_static_number(expression: &Expression<'_>) -> Option<f64> {
    match strip_js_min_max_parentheses(expression) {
        Expression::NumericLiteral(literal) if literal.value.is_finite() => Some(literal.value),
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            let value = js_min_max_static_number(&unary.argument)?;
            Some(if unary.operator == UnaryOperator::UnaryNegation {
                -value
            } else {
                value
            })
        }
        _ => None,
    }
}

fn js_min_max_is_safe_fresh_numeric_array(array: &ArrayExpression<'_>) -> bool {
    if array.elements.is_empty() || array.elements.len() > MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT {
        return false;
    }
    let mut has_positive_zero = false;
    let mut has_negative_zero = false;
    for element in &array.elements {
        let Some(expression) = element.as_expression() else {
            return false;
        };
        let Some(value) = js_min_max_static_number(expression) else {
            return false;
        };
        if value == 0.0 {
            if value.is_sign_negative() {
                has_negative_zero = true;
            } else {
                has_positive_zero = true;
            }
        }
    }
    !(has_positive_zero && has_negative_zero)
}

fn js_min_max_has_unsafe_math_binding<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .find_binding(node.scope_id(), static_ident!("Math"))
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(
        declaration.kind(),
        AstKind::TSInterfaceDeclaration(_) | AstKind::TSTypeAliasDeclaration(_)
    ) {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return true;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return true;
    };
    !(variable_declaration.kind.is_const()
        && declarator.init.as_ref().is_some_and(|initializer| {
            is_proven_global_namespace_reference(initializer, "Math", ctx)
        }))
}

fn js_min_max_has_unsafe_builtin_mutation<'a>(
    target_function: &str,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| match candidate.kind() {
        AstKind::AssignmentExpression(assignment) => {
            assignment.left.get_expression().is_some_and(|target| {
                js_min_max_is_unsafe_mutation_target(target, target_function, ctx)
            }) || assignment
                .left
                .as_member_expression()
                .is_some_and(|member| {
                    js_min_max_is_unsafe_member_target(member, target_function, ctx)
                })
        }
        AstKind::UpdateExpression(update) => {
            update.argument.get_expression().is_some_and(|target| {
                js_min_max_is_unsafe_mutation_target(target, target_function, ctx)
            })
        }
        AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
            js_min_max_is_unsafe_mutation_target(&unary.argument, target_function, ctx)
        }
        AstKind::CallExpression(call) => {
            js_min_max_is_unsafe_mutation_call(call, target_function, ctx)
        }
        _ => false,
    })
}

fn js_min_max_is_unsafe_mutation_target<'a>(
    target: &'a Expression<'a>,
    target_function: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let target = strip_js_min_max_parentheses(target);
    if js_min_max_is_global_namespace_replacement(target, "Math", ctx) {
        return true;
    }
    target
        .as_member_expression()
        .is_some_and(|member| js_min_max_is_unsafe_member_target(member, target_function, ctx))
}

fn js_min_max_is_unsafe_member_target<'a>(
    member: &'a MemberExpression<'a>,
    target_function: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let property_name = member.static_property_name();
    if is_proven_global_namespace_reference(member.object(), "Math", ctx) {
        return property_name.is_none_or(|name| name == target_function);
    }
    if js_min_max_resolves_to_array_prototype(member.object(), ctx) {
        return property_name.is_none_or(|name| name == "sort");
    }
    is_proven_global_object_reference(member.object(), ctx, &mut rustc_hash::FxHashSet::default())
        && property_name.is_none_or(|name| name == "Math")
}

fn js_min_max_is_global_namespace_replacement<'a>(
    expression: &'a Expression<'a>,
    namespace_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = strip_js_min_max_parentheses(expression);
    if let Expression::Identifier(identifier) = expression {
        return identifier.name == namespace_name
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none();
    }
    expression.as_member_expression().is_some_and(|member| {
        member.static_property_name().as_deref() == Some(namespace_name)
            && is_proven_global_object_reference(
                member.object(),
                ctx,
                &mut rustc_hash::FxHashSet::default(),
            )
    })
}

fn js_min_max_resolves_to_array_prototype<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    js_min_max_resolves_to_array_prototype_inner(
        expression,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )
}

fn js_min_max_resolves_to_array_prototype_inner<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = strip_js_min_max_parentheses(expression);
    if let Expression::Identifier(identifier) = expression {
        return js_min_max_const_initializer(identifier, ctx, visited).is_some_and(|initializer| {
            js_min_max_resolves_to_array_prototype_inner(initializer, ctx, visited)
        });
    }
    if let Some(member) = expression.as_member_expression() {
        if member.static_property_name().as_deref() == Some("prototype") {
            return is_proven_global_namespace_reference(member.object(), "Array", ctx);
        }
        return member.static_property_name().as_deref() == Some("__proto__")
            && matches!(
                strip_js_min_max_parentheses(member.object()),
                Expression::ArrayExpression(_)
            );
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    if !js_min_max_resolves_to_global_method(
        &call.callee,
        &["getPrototypeOf"],
        &["Object", "Reflect"],
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    ) {
        return false;
    }
    call.arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|argument| {
            matches!(
                strip_js_min_max_parentheses(argument),
                Expression::ArrayExpression(_)
            )
        })
}

fn js_min_max_const_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    variable_declaration.kind.is_const().then_some(())?;
    declarator.init.as_ref()
}

fn js_min_max_resolves_to_global_method<'a>(
    expression: &'a Expression<'a>,
    method_names: &[&str],
    namespace_names: &[&str],
    ctx: &LintContext<'a>,
    visited: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = strip_js_min_max_parentheses(expression);
    if let Expression::Identifier(identifier) = expression {
        return js_min_max_const_initializer(identifier, ctx, visited).is_some_and(|initializer| {
            js_min_max_resolves_to_global_method(
                initializer,
                method_names,
                namespace_names,
                ctx,
                visited,
            )
        });
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    member
        .static_property_name()
        .is_some_and(|name| method_names.contains(&name.as_ref()))
        && namespace_names.iter().any(|namespace_name| {
            is_proven_global_namespace_reference(member.object(), namespace_name, ctx)
        })
}

fn js_min_max_is_unsafe_mutation_call<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    target_function: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(target) = call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let property_name = if is_proven_global_namespace_reference(target, "Math", ctx) {
        target_function
    } else if js_min_max_resolves_to_array_prototype(target, ctx) {
        "sort"
    } else if is_proven_global_object_reference(target, ctx, &mut rustc_hash::FxHashSet::default())
    {
        "Math"
    } else {
        return false;
    };
    if js_min_max_resolves_to_global_method(
        &call.callee,
        &["assign"],
        &["Object"],
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    ) {
        return call.arguments.iter().skip(1).any(|argument| {
            argument.as_expression().is_none_or(|properties| {
                js_min_max_object_can_set_property(properties, property_name)
            })
        });
    }
    if js_min_max_resolves_to_global_method(
        &call.callee,
        &["defineProperties"],
        &["Object"],
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    ) {
        return call
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_none_or(|properties| {
                js_min_max_object_can_set_property(properties, property_name)
            });
    }
    if !js_min_max_resolves_to_global_method(
        &call.callee,
        &["defineProperty", "deleteProperty", "set"],
        &["Object", "Reflect"],
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    ) {
        return false;
    }
    call.arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_none_or(|property| match strip_js_min_max_parentheses(property) {
            Expression::StringLiteral(literal) => literal.value == property_name,
            Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::RegExpLiteral(_) => false,
            _ => true,
        })
}

fn js_min_max_object_can_set_property(expression: &Expression<'_>, property_name: &str) -> bool {
    let Expression::ObjectExpression(object) = strip_js_min_max_parentheses(expression) else {
        return true;
    };
    object.properties.iter().any(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return true;
        };
        js_min_max_static_object_property_name(property).is_none_or(|name| name == property_name)
    })
}

fn js_min_max_static_object_property_name(
    property: &oxc_ast::ast::ObjectProperty<'_>,
) -> Option<String> {
    if !property.computed {
        return match &property.key {
            oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => {
                Some(identifier.name.to_string())
            }
            oxc_ast::ast::PropertyKey::Identifier(identifier) => Some(identifier.name.to_string()),
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
            _ => None,
        };
    }
    match &property.key {
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        oxc_ast::ast::PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    .to_string()
            })
        }
        _ => None,
    }
}
