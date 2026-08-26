use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, Expression, Function, FunctionBody,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct NoMirrorPropEffect;

declare_oxc_lint!(
    /// Disallow mirroring a prop into state through an effect.
    NoMirrorPropEffect,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow mirroring a prop into state through an effect.",
);

impl Rule for NoMirrorPropEffect {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function) if function.is_function_declaration() => {
                    if function.id.as_ref().is_some_and(|identifier| {
                        identifier.name != "default"
                            && !is_uppercase_name(identifier.name.as_str())
                    }) {
                        continue;
                    }
                    if let Some(body) = &function.body {
                        check_component(&function.params.items, body, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(component) = declarator
                        .init
                        .as_ref()
                        .and_then(find_inline_component_function)
                    else {
                        continue;
                    };
                    check_inline_component(component, ctx);
                }
                AstKind::ExportDefaultDeclaration(declaration) => {
                    let Some(expression) = declaration.declaration.as_expression() else {
                        continue;
                    };
                    let Some(component) = find_inline_component_function(expression) else {
                        continue;
                    };
                    if matches!(component, InlineComponent::Function(function) if function.is_function_declaration()) {
                        continue;
                    }
                    check_inline_component(component, ctx);
                }
                _ => {}
            }
        }
    }
}

#[derive(Clone, Copy)]
enum InlineComponent<'a> {
    Function(&'a Function<'a>),
    Arrow(&'a oxc_ast::ast::ArrowFunctionExpression<'a>),
}

fn find_inline_component_function<'a>(expression: &'a Expression<'a>) -> Option<InlineComponent<'a>> {
    match expression {
        Expression::FunctionExpression(function) => Some(InlineComponent::Function(function)),
        Expression::ArrowFunctionExpression(function) => Some(InlineComponent::Arrow(function)),
        Expression::CallExpression(call) => call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .find_map(find_inline_component_function),
        _ => None,
    }
}

fn check_inline_component<'a>(component: InlineComponent<'a>, ctx: &LintContext<'a>) {
    match component {
        InlineComponent::Function(function) => {
            if let Some(body) = &function.body {
                check_component(&function.params.items, body, ctx);
            }
        }
        InlineComponent::Arrow(function) => {
            if let Some(body) = function.body.as_function_body() {
                check_component(&function.params.items, body, ctx);
            }
        }
    }
}

struct MirrorBinding<'a> {
    value_name: &'a str,
    setter_name: &'a str,
    initializer: &'a Expression<'a>,
    prop_root_name: &'a str,
}

fn check_component<'a>(
    parameters: &'a [oxc_ast::ast::FormalParameter<'a>],
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) {
    let mut prop_names = rustc_hash::FxHashSet::default();
    for parameter in parameters {
        collect_binding_pattern_names(&parameter.pattern, &mut prop_names);
    }
    if prop_names.is_empty() {
        return;
    }

    let mirror_bindings = collect_mirror_bindings(&body.statements, &prop_names, ctx);
    if mirror_bindings.is_empty() {
        return;
    }

    for statement in &body.statements {
        let Statement::ExpressionStatement(expression_statement) = statement else {
            continue;
        };
        let Some(Expression::CallExpression(effect_call)) =
            unwrap_discarded_expression(&expression_statement.expression)
        else {
            continue;
        };
        if effect_call.arguments.len() < 2
            || !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx)
        {
            continue;
        }
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let dependency_names = dependencies
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
            .filter_map(|expression| match expression {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                _ => None,
            })
            .collect::<rustc_hash::FxHashSet<_>>();
        if dependency_names.is_empty() {
            continue;
        }
        let Some(setter_call) = sole_effect_setter_call(effect_call) else {
            continue;
        };
        let Expression::Identifier(setter_identifier) = &setter_call.callee else {
            continue;
        };
        if !is_setter_name(setter_identifier.name.as_str()) {
            continue;
        }
        let Some(setter_argument) = setter_call.arguments.first().and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(binding) = mirror_bindings.iter().find(|binding| {
            binding.setter_name == setter_identifier.name
                && dependency_names.contains(binding.prop_root_name)
                && dependency_names.iter().all(|dependency_name| {
                    *dependency_name == binding.prop_root_name
                        || *dependency_name == binding.setter_name
                })
                && mirror_expressions_structurally_equal(binding.initializer, setter_argument)
        }) else {
            continue;
        };
        if is_initial_only_prop_name(binding.prop_root_name) {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your screen shows the old value first because useState \"{}\" copies prop \"{}\" through this effect.",
                binding.value_name, binding.prop_root_name,
            ))
            .with_label(effect_call.span),
        );
    }
}

fn collect_mirror_bindings<'a>(
    statements: &'a [Statement<'a>],
    prop_names: &rustc_hash::FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> Vec<MirrorBinding<'a>> {
    let mut bindings = Vec::new();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(value_identifier)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter_identifier)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !is_setter_name(setter_identifier.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(state_call)) = &declarator.init else {
                continue;
            };
            if !is_react_hook_call(state_call, &["useState"], ctx) {
                continue;
            }
            let Some(initializer) = state_call.arguments.first().and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(prop_root_name) = prop_root_name(initializer, prop_names) else {
                continue;
            };
            bindings.push(MirrorBinding {
                value_name: value_identifier.name.as_str(),
                setter_name: setter_identifier.name.as_str(),
                initializer,
                prop_root_name,
            });
        }
    }
    bindings
}

fn prop_root_name<'a>(
    expression: &'a Expression<'a>,
    prop_names: &rustc_hash::FxHashSet<String>,
) -> Option<&'a str> {
    let mut cursor = expression;
    loop {
        cursor = cursor.get_inner_expression();
        if let Some(member) = cursor.as_member_expression() {
            cursor = member.object();
            continue;
        }
        if let Expression::CallExpression(call) = cursor {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            cursor = member.object();
            continue;
        }
        break;
    }
    let Expression::Identifier(identifier) = cursor else {
        return None;
    };
    prop_names
        .contains(identifier.name.as_str())
        .then_some(identifier.name.as_str())
}

fn sole_effect_setter_call<'a>(
    effect_call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let callback = effect_call.arguments.first()?.as_expression()?;
    let expression = match callback {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                expression
            } else {
                sole_callback_statement_expression(function.body.as_function_body()?)?
            }
        }
        Expression::FunctionExpression(function) => {
            sole_callback_statement_expression(function.body.as_deref()?)?
        }
        _ => return None,
    };
    let Expression::CallExpression(call) = unwrap_discarded_expression(expression)? else {
        return None;
    };
    Some(call.as_ref())
}

fn sole_callback_statement_expression<'a>(body: &'a FunctionBody<'a>) -> Option<&'a Expression<'a>> {
    let mut expression = None;
    for statement in &body.statements {
        if is_no_op_statement(statement) {
            continue;
        }
        let candidate = match statement {
            Statement::ExpressionStatement(statement) => Some(&statement.expression),
            Statement::ReturnStatement(statement) => statement.argument.as_ref(),
            _ => return None,
        };
        let candidate = candidate?;
        if expression.replace(candidate).is_some() {
            return None;
        }
    }
    expression
}

fn unwrap_discarded_expression<'a>(
    mut expression: &'a Expression<'a>,
) -> Option<&'a Expression<'a>> {
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                expression = &unary.argument;
            }
            Expression::SequenceExpression(sequence)
                if sequence.expressions.len() > 1
                    && sequence.expressions[..sequence.expressions.len() - 1]
                        .iter()
                        .all(|expression| expression.get_inner_expression().is_literal()) =>
            {
                expression = sequence.expressions.last()?;
            }
            _ => return Some(expression),
        }
    }
}

fn mirror_expressions_structurally_equal(first: &Expression<'_>, second: &Expression<'_>) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
        }
        (Expression::PrivateFieldExpression(first), Expression::PrivateFieldExpression(second)) => {
            first.field.name == second.field.name
        }
        (Expression::StringLiteral(first), Expression::StringLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BooleanLiteral(first), Expression::BooleanLiteral(second)) => {
            first.value == second.value
        }
        (Expression::NumericLiteral(first), Expression::NumericLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            mirror_expressions_structurally_equal(&first.callee, &second.callee)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) =
                            (first_argument.as_expression(), second_argument.as_expression())
                        else {
                            return false;
                        };
                        mirror_expressions_structurally_equal(first_argument, second_argument)
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (Some(first), Some(second)) if first.is_computed() == second.is_computed() => {
                mirror_expressions_structurally_equal(first.object(), second.object())
                    && match (first, second) {
                        (
                            oxc_ast::ast::MemberExpression::StaticMemberExpression(first),
                            oxc_ast::ast::MemberExpression::StaticMemberExpression(second),
                        ) => first.property.name == second.property.name,
                        (
                            oxc_ast::ast::MemberExpression::ComputedMemberExpression(first),
                            oxc_ast::ast::MemberExpression::ComputedMemberExpression(second),
                        ) => mirror_expressions_structurally_equal(
                            &first.expression,
                            &second.expression,
                        ),
                        (
                            oxc_ast::ast::MemberExpression::PrivateFieldExpression(first),
                            oxc_ast::ast::MemberExpression::PrivateFieldExpression(second),
                        ) => first.field.name == second.field.name,
                        _ => false,
                    }
            }
            _ => false,
        },
    }
}

fn is_initial_only_prop_name(name: &str) -> bool {
    matches!(name, "initialValue" | "defaultValue" | "seedValue")
        || ["initial", "default", "seed", "starting", "baseline", "preset"]
            .iter()
            .any(|prefix| {
                name.strip_prefix(prefix)
                    .and_then(|suffix| suffix.as_bytes().first())
                    .is_some_and(u8::is_ascii_uppercase)
            })
}

fn is_setter_name(name: &str) -> bool {
    name.starts_with("set") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
