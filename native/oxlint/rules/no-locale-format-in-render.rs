use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, JSXAttributeName, ObjectPropertyKind, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::LogicalOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoLocaleFormatInRender;

declare_oxc_lint!(
    /// Warns about environment-dependent locale formatting during hydration.
    NoLocaleFormatInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Locale/timezone formatting during render.",
);

impl Rule for NoLocaleFormatInRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_react_native_file_target(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_use_client = locale_file_has_use_client(ctx);
        if locale_file_is_email_template(ctx) {
            return;
        }
        let mut reported_spans = FxHashSet::default();
        let mut scanned_helper_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let Some(display) = locale_format_match(node, ctx) else {
                continue;
            };
            let Some(component) = find_render_phase_component_or_hook(node, ctx) else {
                continue;
            };
            if !has_use_client && !locale_component_has_client_evidence(component, ctx) {
                continue;
            }
            if locale_has_suppress_hydration_warning(node, ctx)
                || locale_is_after_client_only_early_return(node, component, ctx)
                || locale_is_gated_by_initial_state(node, ctx)
            {
                continue;
            }
            reported_spans.insert((node.span().start, node.span().end));
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This can cause a hydration mismatch because {display} formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone."
                ))
                .with_label(node.span()),
            );
        }
        for container_node in ctx.nodes().iter() {
            let AstKind::JSXExpressionContainer(container) = container_node.kind() else {
                continue;
            };
            let Some(Expression::CallExpression(helper_call)) = container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            let Expression::Identifier(helper_identifier) =
                helper_call.callee.get_inner_expression()
            else {
                continue;
            };
            let Some(helper_node) = locale_resolve_helper_function(helper_identifier, ctx) else {
                continue;
            };
            if component_or_hook_function_name(helper_node, ctx).is_some() {
                continue;
            }
            let Some(component) = find_render_phase_component_or_hook(container_node, ctx) else {
                continue;
            };
            if !has_use_client && !locale_component_has_client_evidence(component, ctx) {
                continue;
            }
            if locale_has_suppress_hydration_warning(container_node, ctx)
                || locale_is_after_client_only_early_return(container_node, component, ctx)
                || locale_is_gated_by_initial_state(container_node, ctx)
            {
                continue;
            }
            if !scanned_helper_ids.insert(helper_node.id()) {
                continue;
            }
            for candidate in ctx.nodes().iter() {
                if !helper_node.span().contains_inclusive(candidate.span())
                    || crate::ast_util::get_enclosing_function(candidate, ctx)
                        .is_none_or(|function| function.id() != helper_node.id())
                {
                    continue;
                }
                let AstKind::CallExpression(call) = candidate.kind() else {
                    continue;
                };
                let Some(display) =
                    locale_method_call(call, ctx).or_else(|| locale_intl_format_call(call, ctx))
                else {
                    continue;
                };
                if !reported_spans.insert((candidate.span().start, candidate.span().end)) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This can cause a hydration mismatch because {display} (reached from JSX through \"{}\") formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone.",
                        helper_identifier.name
                    ))
                    .with_label(candidate.span()),
                );
            }
        }
    }
}

fn locale_resolve_helper_function<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(ctx.nodes().get_node(function.node_id.get())),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                Expression::FunctionExpression(function) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn locale_file_has_use_client(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        matches!(node.kind(), AstKind::Program(program)
            if program.directives.iter().any(|directive| directive.directive == "use client"))
    })
}

fn locale_file_is_email_template(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().requested_modules.keys().any(|source| {
        let source = source.as_str();
        source.starts_with("@react-email/") || source == "react-email"
    })
}

fn locale_component_has_client_evidence<'ast>(
    component: &AstNode<'ast>,
    ctx: &LintContext<'ast>,
) -> bool {
    if component_or_hook_function_name(component, ctx).is_some_and(locale_is_hook_name) {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        component.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::CallExpression(call)
                if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if locale_is_hook_name(identifier.name.as_str())))
    })
}

fn locale_is_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn locale_format_match<'ast>(node: &AstNode<'ast>, ctx: &LintContext<'ast>) -> Option<String> {
    match node.kind() {
        AstKind::CallExpression(call) => locale_method_call(call, ctx)
            .or_else(|| locale_intl_format_call(call, ctx))
            .or_else(|| locale_date_stringification(call, ctx)),
        AstKind::TemplateLiteral(template) => template
            .expressions
            .iter()
            .any(locale_is_input_date_construction)
            .then_some("`${new Date(…)}`".to_string()),
        _ => None,
    }
}

fn locale_method_call<'ast>(
    call: &oxc_ast::ast::CallExpression<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<String> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let method = static_member_expression_property_name(member)?;
    if !matches!(
        method,
        "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString"
    ) {
        return None;
    }
    let receiver = member.object().get_inner_expression();
    let receiver_is_date = locale_is_date_construction(receiver);
    if method == "toLocaleString"
        && !receiver_is_date
        && !locale_receiver_name_looks_date_flavored(receiver)
    {
        return None;
    }
    if locale_has_explicit_locale(call.arguments.first(), ctx) {
        if locale_options_have_timezone(call.arguments.get(1), ctx)
            || method == "toLocaleString" && !receiver_is_date
        {
            return None;
        }
    }
    Some(format!("{method}()"))
}

fn locale_intl_format_call<'ast>(
    call: &oxc_ast::ast::CallExpression<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<String> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let method = static_member_expression_property_name(member)?;
    if !matches!(method, "format" | "formatToParts" | "formatRange") {
        return None;
    }
    let mut construction = member.object().get_inner_expression();
    if let Expression::Identifier(identifier) = construction {
        construction = identifier_initializer(identifier, ctx)?.get_inner_expression();
    }
    let (formatter, arguments) = match construction {
        Expression::CallExpression(construction) => (
            locale_intl_formatter_name(&construction.callee, ctx)?,
            construction.arguments.as_slice(),
        ),
        Expression::NewExpression(construction) => (
            locale_intl_formatter_name(&construction.callee, ctx)?,
            construction.arguments.as_slice(),
        ),
        _ => return None,
    };
    if locale_has_explicit_locale(arguments.first(), ctx)
        && (formatter == "RelativeTimeFormat"
            || locale_options_have_timezone(arguments.get(1), ctx))
    {
        return None;
    }
    Some(format!("Intl.{formatter}().{method}()"))
}

fn locale_intl_formatter_name<'a>(
    callee: &'a Expression<'a>,
    ctx: &LintContext<'_>,
) -> Option<&'a str> {
    let member = callee.get_inner_expression().as_member_expression()?;
    let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
        return None;
    };
    if namespace.name != "Intl" || !ctx.is_reference_to_global_variable(namespace) {
        return None;
    }
    let formatter = static_member_expression_property_name(member)?;
    matches!(formatter, "DateTimeFormat" | "RelativeTimeFormat").then_some(formatter)
}

fn locale_date_stringification(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && static_member_expression_property_name(member) == Some("toString")
        && locale_is_input_date_construction(member.object())
    {
        return Some("Date.prototype.toString()".to_string());
    }
    if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "String" && ctx.is_reference_to_global_variable(identifier))
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(locale_is_input_date_construction)
    {
        return Some("String(new Date(…))".to_string());
    }
    None
}

fn locale_is_date_construction(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NewExpression(construction)
        if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Date"))
}

fn locale_is_input_date_construction(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NewExpression(construction)
        if !construction.arguments.is_empty()
            && matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Date"))
}

fn locale_receiver_name_looks_date_flavored(expression: &Expression<'_>) -> bool {
    let name = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.as_str(),
        expression => expression
            .as_member_expression()
            .and_then(static_member_expression_property_name)
            .unwrap_or_default(),
    };
    let lowercase = name.to_ascii_lowercase();
    [
        "date",
        "time",
        "timestamp",
        "deadline",
        "created",
        "updated",
        "scheduled",
        "expire",
        "moment",
        "when",
        "birthday",
        "dob",
    ]
    .iter()
    .any(|fragment| lowercase.contains(fragment))
        || lowercase.ends_with("at")
}

fn locale_has_explicit_locale(argument: Option<&Argument<'_>>, ctx: &LintContext<'_>) -> bool {
    let Some(argument) = argument.and_then(Argument::as_expression) else {
        return false;
    };
    !matches!(argument.get_inner_expression(), Expression::UnaryExpression(unary)
        if unary.operator == oxc_syntax::operator::UnaryOperator::Void)
        && !matches!(argument.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
}

fn locale_options_have_timezone<'ast>(
    argument: Option<&Argument<'ast>>,
    ctx: &LintContext<'ast>,
) -> bool {
    let Some(mut expression) = argument.and_then(Argument::as_expression) else {
        return false;
    };
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(initializer) = identifier_initializer(identifier, ctx)
    {
        expression = initializer;
    }
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return false;
    };
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => return false,
            ObjectPropertyKind::ObjectProperty(property) => {
                if property.key.static_name().as_deref() != Some("timeZone") {
                    continue;
                }
                return !matches!(property.value.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
                    && !matches!(property.value.get_inner_expression(), Expression::UnaryExpression(unary)
                        if unary.operator == oxc_syntax::operator::UnaryOperator::Void);
            }
        }
    }
    false
}

fn locale_has_suppress_hydration_warning(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        element.opening_element.attributes.iter().any(|attribute| {
            matches!(attribute, oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name == "suppressHydrationWarning"))
        })
    })
}

fn locale_is_after_client_only_early_return<'a>(
    node: &AstNode<'a>,
    component: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let body = match component.kind() {
        AstKind::Function(function) => function.body.as_deref(),
        AstKind::ArrowFunctionExpression(function) => function.get_function_body(),
        _ => None,
    };
    let Some(body) = body else {
        return false;
    };
    for statement in &body.statements {
        if statement.span().contains_inclusive(node.span()) {
            return false;
        }
        let Statement::IfStatement(statement) = statement else {
            continue;
        };
        let initial_value = locale_read_initial_state_boolean(&statement.test, ctx);
        if initial_value == Some(true) && statement_always_exits(&statement.consequent) {
            return true;
        }
        if initial_value == Some(false)
            && statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| statement_always_exits(alternate))
        {
            return true;
        }
    }
    false
}

fn locale_is_gated_by_initial_state<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let is_gated = match ancestor.kind() {
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                let initial_value = locale_read_initial_state_boolean(&logical.left, ctx);
                (logical.operator == LogicalOperator::And && initial_value == Some(false))
                    || (logical.operator == LogicalOperator::Or && initial_value == Some(true))
            }
            AstKind::ConditionalExpression(conditional) => {
                let initial_value = locale_read_initial_state_boolean(&conditional.test, ctx);
                (conditional.consequent.span() == child_span && initial_value == Some(false))
                    || (conditional.alternate.span() == child_span && initial_value == Some(true))
            }
            AstKind::IfStatement(statement) => {
                let initial_value = locale_read_initial_state_boolean(&statement.test, ctx);
                (statement.consequent.span() == child_span && initial_value == Some(false))
                    || (statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child_span)
                        && initial_value == Some(true))
            }
            _ => false,
        };
        if is_gated {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn locale_read_initial_state_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    locale_read_initial_state_boolean_inner(expression, ctx, &mut FxHashSet::default(), false)
}

fn locale_read_initial_state_boolean_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<oxc_semantic::SymbolId>,
    allow_lazy_initializer: bool,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if let Some(truthiness) = static_literal_truthiness(expression) {
        return Some(truthiness);
    }
    match expression {
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier) {
                return Some(false);
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if let BindingPattern::ArrayPattern(pattern) = &declarator.id
                && pattern
                    .elements
                    .first()
                    .and_then(Option::as_ref)
                    .and_then(BindingPattern::get_binding_identifier)
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && let Some(Expression::CallExpression(call)) = declarator
                    .init
                    .as_ref()
                    .map(Expression::get_inner_expression)
                && is_react_api_call(call, "useState", ctx)
            {
                let Some(initializer) = call.arguments.first() else {
                    return Some(false);
                };
                return locale_read_initial_state_boolean_inner(
                    initializer.as_expression()?,
                    ctx,
                    visited_symbols,
                    true,
                );
            }
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || !matches!(&declarator.id, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
            {
                return None;
            }
            locale_read_initial_state_boolean_inner(
                declarator.init.as_ref()?,
                ctx,
                visited_symbols,
                allow_lazy_initializer,
            )
        }
        Expression::ArrowFunctionExpression(function)
            if allow_lazy_initializer && !function.r#async =>
        {
            let returned_expression = function.get_expression().or_else(|| {
                let body = function.get_function_body()?;
                if !body.directives.is_empty() || body.statements.len() != 1 {
                    return None;
                }
                let Statement::ReturnStatement(statement) = &body.statements[0] else {
                    return None;
                };
                statement.argument.as_ref()
            })?;
            locale_read_initial_state_boolean_inner(
                returned_expression,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::FunctionExpression(function)
            if allow_lazy_initializer && !function.r#async && !function.generator =>
        {
            let body = function.body.as_deref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            locale_read_initial_state_boolean_inner(
                statement.argument.as_ref()?,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            locale_read_initial_state_boolean_inner(&unary.argument, ctx, visited_symbols, false)
                .map(|value| !value)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let mut left_visited_symbols = visited_symbols.clone();
            let left = locale_read_initial_state_boolean_inner(
                &logical.left,
                ctx,
                &mut left_visited_symbols,
                false,
            );
            let mut right_visited_symbols = visited_symbols.clone();
            let right = locale_read_initial_state_boolean_inner(
                &logical.right,
                ctx,
                &mut right_visited_symbols,
                false,
            );
            match logical.operator {
                LogicalOperator::And if left == Some(false) || right == Some(false) => Some(false),
                LogicalOperator::And if left == Some(true) && right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(true) || right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(false) && right == Some(false) => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}
