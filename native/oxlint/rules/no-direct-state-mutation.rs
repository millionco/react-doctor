use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, FunctionBody, FunctionType, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    context::LintContext,
    rule::Rule,
};

const MUTATING_ARRAY_METHOD_NAMES: [&str; 9] = [
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
const PLAIN_DATA_PRODUCER_GLOBAL_NAMES: [&str; 2] = ["Array", "structuredClone"];
const PLAIN_DATA_ARRAY_STATIC_METHODS: [&str; 2] = ["from", "of"];
const PLAIN_DATA_JSON_STATIC_METHODS: [&str; 1] = ["parse"];
const PLAIN_DATA_OBJECT_STATIC_METHODS: [&str; 5] =
    ["assign", "entries", "fromEntries", "keys", "values"];
const ARRAY_COPY_METHOD_NAMES: [&str; 10] = [
    "map",
    "filter",
    "slice",
    "concat",
    "flat",
    "flatMap",
    "toSorted",
    "toReversed",
    "toSpliced",
    "with",
];
const PLAIN_DATA_CONSTRUCTOR_NAMES: [&str; 2] = ["Array", "Object"];

#[derive(Debug, Default, Clone)]
pub struct NoDirectStateMutation;

declare_oxc_lint!(
    /// Disallows mutating React-owned state in place.
    NoDirectStateMutation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow mutating React-owned state in place.",
);

impl Rule for NoDirectStateMutation {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    let Some(identifier) = &function.id else {
                        continue;
                    };
                    if !direct_state_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(body) = &function.body else {
                        continue;
                    };
                    direct_state_check_component(body, ctx);
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !direct_state_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            let Some(body) = function.body.as_function_body() else {
                                continue;
                            };
                            direct_state_check_component(body, ctx);
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            let Some(body) = &function.body else {
                                continue;
                            };
                            direct_state_check_component(body, ctx);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

struct DirectStateBinding<'a> {
    value_name: &'a str,
    setter_name: &'a str,
    value_symbol_id: SymbolId,
    setter_symbol_id: SymbolId,
    initializer_argument: Option<&'a Argument<'a>>,
}

#[derive(Default)]
struct SetterValueObservations<'a> {
    plain_fed_setter_names: FxHashSet<&'a str>,
    opaque_fed_setter_names: FxHashSet<&'a str>,
    callback_ref_setter_names: FxHashSet<&'a str>,
}

fn direct_state_check_component<'a>(body: &'a FunctionBody<'a>, ctx: &LintContext<'a>) {
    let bindings = direct_state_collect_bindings(body, ctx);
    if bindings.is_empty() {
        return;
    }
    let observations = direct_state_collect_setter_observations(&bindings, ctx);
    for binding in &bindings {
        if observations
            .callback_ref_setter_names
            .contains(binding.setter_name)
            || !direct_state_initializer_marks_plain_state(binding.initializer_argument)
        {
            continue;
        }
        let is_nullish_initializer = binding.initializer_argument.is_none()
            || binding
                .initializer_argument
                .and_then(Argument::as_expression)
                .is_some_and(direct_state_is_nullish_expression);
        if is_nullish_initializer
            && observations
                .opaque_fed_setter_names
                .contains(binding.setter_name)
            && !observations
                .plain_fed_setter_names
                .contains(binding.setter_name)
        {
            continue;
        }
        direct_state_report_mutations(binding, ctx);
    }
}

fn direct_state_collect_bindings<'a>(
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) -> Vec<DirectStateBinding<'a>> {
    let mut bindings = Vec::new();
    for statement in &body.statements {
        let oxc_ast::ast::Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(value_binding)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter_binding)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !direct_state_is_setter_name(setter_binding.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(state_call)) = &declarator.init else {
                continue;
            };
            if !is_react_hook_call(state_call, &["useState"], ctx) {
                continue;
            }
            bindings.push(DirectStateBinding {
                value_name: value_binding.name.as_str(),
                setter_name: setter_binding.name.as_str(),
                value_symbol_id: value_binding.symbol_id(),
                setter_symbol_id: setter_binding.symbol_id(),
                initializer_argument: state_call.arguments.first(),
            });
        }
    }
    bindings
}

fn direct_state_collect_setter_observations<'a>(
    bindings: &[DirectStateBinding<'a>],
    ctx: &LintContext<'a>,
) -> SetterValueObservations<'a> {
    let mut observations = SetterValueObservations::default();
    for binding in bindings {
        for reference in ctx
            .scoping()
            .get_resolved_references(binding.setter_symbol_id)
        {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if matches!(parent.kind(), AstKind::JSXExpressionContainer(_)) {
                let attribute = ctx.nodes().parent_node(parent.id());
                if matches!(attribute.kind(), AstKind::JSXAttribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "ref"))
                {
                    observations
                        .callback_ref_setter_names
                        .insert(binding.setter_name);
                }
                continue;
            }
            let AstKind::CallExpression(call) = parent.kind() else {
                continue;
            };
            if call.callee.span() != reference_root.span() {
                continue;
            }
            let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            if direct_state_is_nullish_expression(argument) {
                continue;
            }
            if direct_state_produces_plain_state_value(argument) {
                observations
                    .plain_fed_setter_names
                    .insert(binding.setter_name);
            } else if direct_state_produces_opaque_instance_value(argument) {
                observations
                    .opaque_fed_setter_names
                    .insert(binding.setter_name);
            }
        }
    }
    observations
}

fn direct_state_report_mutations<'a>(binding: &DirectStateBinding<'a>, ctx: &LintContext<'a>) {
    for reference in ctx
        .scoping()
        .get_resolved_references(binding.value_symbol_id)
    {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let mut expression_root = transparent_expression_root(reference_node, ctx);
        loop {
            let parent = ctx.nodes().parent_node(expression_root.id());
            let Some(member) = parent.kind().as_member_expression_kind() else {
                break;
            };
            if member.object().span() != expression_root.span() {
                break;
            }
            expression_root = transparent_expression_root(parent, ctx);
        }
        let parent = ctx.nodes().parent_node(expression_root.id());
        if let AstKind::AssignmentExpression(assignment) = parent.kind()
            && assignment.left.span() == expression_root.span()
            && expression_root.kind().as_member_expression_kind().is_some()
        {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "React can't tell you changed \"{}\" in place, so this update can be skipped or lost.",
                    binding.value_name
                ))
                .with_label(assignment.span),
            );
            continue;
        }
        let AstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        if call.callee.span() != expression_root.span() {
            continue;
        }
        let Some(member) = expression_root.kind().as_member_expression_kind() else {
            continue;
        };
        let Some(method_name) = direct_state_member_kind_identifier_property_name(member) else {
            continue;
        };
        if !MUTATING_ARRAY_METHOD_NAMES.contains(&method_name) {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "React can't tell .{method_name}() changed \"{}\" in place, so this update can be skipped or lost.",
                binding.value_name
            ))
            .with_label(call.span),
        );
    }
}

fn direct_state_initializer_marks_plain_state(argument: Option<&Argument<'_>>) -> bool {
    let Some(argument) = argument else {
        return true;
    };
    let Some(initializer) = argument.as_expression() else {
        return false;
    };
    match initializer.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return direct_state_produces_plain_state_value(expression);
            }
            function.get_function_body().is_some_and(|body| {
                body.statements.iter().any(|statement| {
                    matches!(statement, oxc_ast::ast::Statement::ReturnStatement(statement)
                        if statement.argument.as_ref().is_some_and(direct_state_produces_plain_state_value))
                })
            })
        }
        Expression::FunctionExpression(function) => function.body.as_ref().is_some_and(|body| {
            body.statements.iter().any(|statement| {
                matches!(statement, oxc_ast::ast::Statement::ReturnStatement(statement)
                    if statement.argument.as_ref().is_some_and(direct_state_produces_plain_state_value))
            })
        }),
        expression => direct_state_produces_plain_state_value(expression),
    }
}

fn direct_state_produces_plain_state_value(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
    ) || direct_state_is_plain_data_new_expression(expression)
        || direct_state_is_nullish_expression(expression)
    {
        return true;
    }
    if expression.as_member_expression().is_some()
        && direct_state_root_identifier_name(expression) == Some("props")
    {
        return true;
    }
    direct_state_is_plain_data_producer_call(expression)
}

fn direct_state_is_plain_data_producer_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return PLAIN_DATA_PRODUCER_GLOBAL_NAMES.contains(&identifier.name.as_str());
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    let Some(property_name) = direct_state_member_identifier_property_name(member) else {
        return false;
    };
    if let Expression::Identifier(receiver) = member.object().get_inner_expression() {
        let allowed_methods = match receiver.name.as_str() {
            "Array" => PLAIN_DATA_ARRAY_STATIC_METHODS.as_slice(),
            "JSON" => PLAIN_DATA_JSON_STATIC_METHODS.as_slice(),
            "Object" => PLAIN_DATA_OBJECT_STATIC_METHODS.as_slice(),
            _ => &[],
        };
        if allowed_methods.contains(&property_name) {
            return true;
        }
    }
    direct_state_produces_plain_state_value(member.object())
}

fn direct_state_produces_opaque_instance_value(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(_) = expression {
        return !direct_state_is_plain_data_new_expression(expression);
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if direct_state_is_plain_data_producer_call(expression) {
        return false;
    }
    if !member.is_computed()
        && direct_state_member_identifier_property_name(member)
            .is_some_and(|name| ARRAY_COPY_METHOD_NAMES.contains(&name))
    {
        return false;
    }
    true
}

fn direct_state_is_plain_data_new_expression(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NewExpression(new_expression)
        if matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
            if PLAIN_DATA_CONSTRUCTOR_NAMES.contains(&identifier.name.as_str())))
}

fn direct_state_is_nullish_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    ) || matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined")
}

fn direct_state_root_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => {
            direct_state_root_identifier_name(expression.as_member_expression()?.object())
        }
    }
}

fn direct_state_member_identifier_property_name<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'a str> {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = member.expression.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn direct_state_member_kind_identifier_property_name<'a>(
    member: oxc_ast::MemberExpressionKind<'a>,
) -> Option<&'a str> {
    match member {
        oxc_ast::MemberExpressionKind::Static(member) => Some(member.property.name.as_str()),
        oxc_ast::MemberExpressionKind::Computed(member) => {
            let Expression::Identifier(identifier) = member.expression.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        oxc_ast::MemberExpressionKind::PrivateField(_) => None,
    }
}

fn direct_state_is_setter_name(name: &str) -> bool {
    name.strip_prefix("set")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn direct_state_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
