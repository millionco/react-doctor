use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttributeName, JSXElementName, JSXMemberExpressionObject,
        Statement,
    },
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

const DIRECT_MESSAGE_SUFFIX: &str = "in JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.";
const REACHED_MESSAGE_SUFFIX: &str = "reached from JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.";
const EMAIL_TEMPLATE_MODULES: [&str; 4] =
    ["@faire/mjml-react", "mjml-react", "mjml", "react-email"];
const EMAIL_TEMPLATE_MODULE_PREFIXES: [&str; 2] = ["@react-email/", "jsx-email"];

#[derive(Debug, Default, Clone)]
pub struct RenderingHydrationMismatchTime;

declare_oxc_lint!(
    /// Warns about time and random values evaluated directly in hydrating JSX.
    RenderingHydrationMismatchTime,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Time or random value in JSX.",
);

impl Rule for RenderingHydrationMismatchTime {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && !is_react_native_file_target(ctx)
            && !is_generated_image_render_filename(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if hydration_time_is_email_template(ctx) {
            return;
        }
        let generated_image_opening_element_ids = generated_image_jsx_opening_element_ids(ctx);
        let mut candidates = ctx
            .nodes()
            .iter()
            .filter_map(|candidate| {
                hydration_time_pattern(candidate).map(|display| (candidate.id(), display))
            })
            .collect::<Vec<_>>();
        candidates.sort_unstable_by_key(|(candidate_id, _)| {
            ctx.nodes().get_node(*candidate_id).span().start
        });

        for container_node in ctx.nodes().iter() {
            let AstKind::JSXExpressionContainer(container) = container_node.kind() else {
                continue;
            };
            let Some(container_expression) = container.expression.as_expression() else {
                continue;
            };
            if hydration_time_is_generated_image_container(
                container_node,
                &generated_image_opening_element_ids,
                ctx,
            ) || hydration_time_has_suppress_warning(container_node, ctx)
            {
                continue;
            }

            let container_span = container_expression.span();
            let first_candidate_index = candidates.partition_point(|(candidate_id, _)| {
                ctx.nodes().get_node(*candidate_id).span().start < container_span.start
            });
            let contained_candidates = candidates[first_candidate_index..]
                .iter()
                .take_while(|(candidate_id, _)| {
                    ctx.nodes().get_node(*candidate_id).span().start <= container_span.end
                })
                .filter(|(candidate_id, _)| {
                    container_span.contains_inclusive(ctx.nodes().get_node(*candidate_id).span())
                });

            for (candidate_id, display) in contained_candidates {
                let candidate = ctx.nodes().get_node(*candidate_id);
                if hydration_time_is_gated_by_initial_state(candidate, ctx)
                    || hydration_time_is_inside_motion_transition(candidate, ctx)
                {
                    continue;
                }
                if container_span == candidate.span() {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "This can cause a hydration mismatch because {display} {DIRECT_MESSAGE_SUFFIX}"
                        ))
                        .with_label(container_node.span()),
                    );
                    break;
                }
                if hydration_time_is_deferred_by_nested_function(candidate, container_node, ctx)
                    || *display == "new Date()"
                        && hydration_time_is_year_only_date_read(candidate, ctx)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This can cause a hydration mismatch because {display} {REACHED_MESSAGE_SUFFIX}"
                    ))
                    .with_label(candidate.span()),
                );
            }
        }
    }
}

fn hydration_time_pattern(node: &AstNode<'_>) -> Option<&'static str> {
    match node.kind() {
        AstKind::NewExpression(expression) => {
            matches!(&expression.callee, Expression::Identifier(identifier)
                if identifier.name == "Date" && expression.arguments.is_empty())
            .then_some("new Date()")
        }
        AstKind::CallExpression(call) => {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            if member.is_computed() {
                return None;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            match (receiver.name.as_str(), member.static_property_name()?) {
                ("Date", "now") => Some("Date.now()"),
                ("Math", "random") => Some("Math.random()"),
                ("performance", "now") => Some("performance.now()"),
                ("crypto", "randomUUID") => Some("crypto.randomUUID()"),
                _ => None,
            }
        }
        _ => None,
    }
}

fn hydration_time_is_deferred_by_nested_function<'a>(
    candidate: &AstNode<'a>,
    container: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == container.id() {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !hydration_time_function_executes_during_render(ancestor, ctx)
        {
            return true;
        }
    }
    false
}

fn hydration_time_function_executes_during_render<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !function_executes_during_render(function_node, ctx) {
        return false;
    }
    let mut callback_span = function_node.span();
    for ancestor in ctx.nodes().ancestors(function_node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSInstantiationExpression(_)
                | AstKind::ChainExpression(_)
        ) {
            callback_span = ancestor.span();
            continue;
        }
        let AstKind::CallExpression(call) = ancestor.kind() else {
            return true;
        };
        if call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == callback_span)
        }) {
            for api_name in ["useMemo", "useState", "startTransition"] {
                if is_react_api_call(call, api_name, ctx)
                    && !hydration_time_is_direct_react_api_call(call, api_name, ctx)
                {
                    return false;
                }
            }
        }
        if call.arguments.get(1).is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == callback_span)
        }) && hydration_time_array_from_callee_is_computed(&call.callee, ctx)
        {
            return false;
        }
        return true;
    }
    true
}

fn hydration_time_is_direct_react_api_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    if !is_react_api_call(call, api_name, ctx) {
        return false;
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return true;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    !matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::VariableDeclarator(_)
    )
}

fn hydration_time_array_from_callee_is_computed<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression() {
        return member.is_computed();
    }
    let Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    declarator
        .init
        .as_ref()
        .and_then(|initializer| initializer.get_inner_expression().as_member_expression())
        .is_some_and(|member| member.is_computed())
}

fn hydration_time_is_year_only_date_read(candidate: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let member_node = ctx.nodes().parent_node(candidate.id());
    let Some(member) = member_node.kind().as_member_expression_kind() else {
        return false;
    };
    if member.object().span() != candidate.span()
        || matches!(member, oxc_ast::MemberExpressionKind::Computed(_))
        || member.static_property_name().as_deref() != Some("getFullYear")
    {
        return false;
    }
    matches!(ctx.nodes().parent_node(member_node.id()).kind(), AstKind::CallExpression(call)
        if call.callee.span() == member_node.span())
}

fn hydration_time_is_email_template(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        let source = entry.module_request.name();
        EMAIL_TEMPLATE_MODULES.contains(&source)
            || EMAIL_TEMPLATE_MODULE_PREFIXES
                .iter()
                .any(|prefix| source.starts_with(prefix))
    })
}

fn hydration_time_opening_element<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b oxc_ast::ast::JSXOpeningElement<'a>> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(element) => return Some(&element.opening_element),
            AstKind::JSXFragment(_) => return None,
            _ => {}
        }
    }
    None
}

fn hydration_time_is_generated_image_container<'a>(
    container: &AstNode<'a>,
    generated_image_opening_element_ids: &std::collections::HashSet<oxc_semantic::NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    hydration_time_opening_element(container, ctx).is_some_and(|opening_element| {
        generated_image_opening_element_ids.contains(&opening_element.node_id.get())
    })
}

fn hydration_time_has_suppress_warning<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    hydration_time_opening_element(node, ctx).is_some_and(|opening_element| {
        opening_element.attributes.iter().any(|attribute| {
            matches!(attribute, oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name == "suppressHydrationWarning"))
        })
    })
}

fn hydration_time_is_inside_motion_transition(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name == "transition")
                {
                    return false;
                }
                let opening_element = ctx.nodes().parent_node(ancestor.id());
                let AstKind::JSXOpeningElement(opening_element) = opening_element.kind() else {
                    return false;
                };
                let JSXElementName::MemberExpression(element_name) = &opening_element.name else {
                    return false;
                };
                return matches!(&element_name.object,
                    JSXMemberExpressionObject::IdentifierReference(identifier)
                        if matches!(identifier.name.as_str(), "motion" | "m"));
            }
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => return false,
            _ => {}
        }
    }
    false
}

fn hydration_time_is_gated_by_initial_state<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let is_gated = match ancestor.kind() {
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                let initial_value = hydration_time_read_initial_state_boolean(&logical.left, ctx);
                logical.operator == LogicalOperator::And && initial_value == Some(false)
                    || logical.operator == LogicalOperator::Or && initial_value == Some(true)
            }
            AstKind::ConditionalExpression(conditional) => {
                let initial_value =
                    hydration_time_read_initial_state_boolean(&conditional.test, ctx);
                conditional.consequent.span() == child_span && initial_value == Some(false)
                    || conditional.alternate.span() == child_span && initial_value == Some(true)
            }
            AstKind::IfStatement(statement) => {
                let initial_value = hydration_time_read_initial_state_boolean(&statement.test, ctx);
                statement.consequent.span() == child_span && initial_value == Some(false)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child_span)
                        && initial_value == Some(true)
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

fn hydration_time_read_initial_state_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    hydration_time_read_initial_state_boolean_inner(
        expression,
        ctx,
        &mut FxHashSet::default(),
        false,
    )
}

fn hydration_time_read_initial_state_boolean_inner<'a>(
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
                && hydration_time_is_direct_react_api_call(call, "useState", ctx)
            {
                let Some(initializer) = call.arguments.first() else {
                    return Some(false);
                };
                return hydration_time_read_initial_state_boolean_inner(
                    initializer.as_expression()?,
                    ctx,
                    visited_symbols,
                    true,
                );
            }
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || !matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id)
            {
                return None;
            }
            hydration_time_read_initial_state_boolean_inner(
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
            hydration_time_read_initial_state_boolean_inner(
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
            hydration_time_read_initial_state_boolean_inner(
                statement.argument.as_ref()?,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            hydration_time_read_initial_state_boolean_inner(
                &unary.argument,
                ctx,
                visited_symbols,
                false,
            )
            .map(|value| !value)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let mut left_visited_symbols = visited_symbols.clone();
            let left = hydration_time_read_initial_state_boolean_inner(
                &logical.left,
                ctx,
                &mut left_visited_symbols,
                false,
            );
            let mut right_visited_symbols = visited_symbols.clone();
            let right = hydration_time_read_initial_state_boolean_inner(
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
