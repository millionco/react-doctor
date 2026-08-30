use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, FunctionBody, FunctionType, Statement, VariableDeclarator},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CONTINUOUS_VALUE_HOOK_PREFIXES: [&str; 9] = [
    "useWindowWidth",
    "useWindowHeight",
    "useWindowDimensions",
    "useScrollPosition",
    "useScrollY",
    "useScrollX",
    "useMousePosition",
    "useResizeObserver",
    "useIntersectionObserver",
];

#[derive(Debug, Default, Clone)]
pub struct RerenderDerivedStateFromHook;

declare_oxc_lint!(
    /// Warns when a component reduces a continuously changing hook value to thresholds.
    RerenderDerivedStateFromHook,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a component reduces a continuously changing hook value to thresholds.",
);

impl Rule for RerenderDerivedStateFromHook {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut identifier_node_ids_by_start = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(
                    node.kind(),
                    AstKind::IdentifierReference(_)
                        | AstKind::BindingIdentifier(_)
                        | AstKind::IdentifierName(_)
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        identifier_node_ids_by_start.sort_unstable_by_key(|node_id| {
            let span = ctx.nodes().get_node(*node_id).span();
            (span.start, span.end)
        });

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            derived_hook_is_component_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        check_continuous_hook_thresholds(body, &identifier_node_ids_by_start, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(component_identifier) = &declarator.id
                    else {
                        continue;
                    };
                    if !derived_hook_is_component_name(component_identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                check_continuous_hook_thresholds(
                                    body,
                                    &identifier_node_ids_by_start,
                                    ctx,
                                );
                            }
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                check_continuous_hook_thresholds(
                                    body,
                                    &identifier_node_ids_by_start,
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn check_continuous_hook_thresholds<'a>(
    component_body: &FunctionBody<'a>,
    identifier_node_ids_by_start: &[NodeId],
    ctx: &LintContext<'a>,
) {
    for (statement_index, statement) in component_body.statements.iter().enumerate() {
        let Statement::VariableDeclaration(variable_declaration) = statement else {
            continue;
        };
        for hook_declarator in &variable_declaration.declarations {
            let BindingPattern::BindingIdentifier(continuous_binding) = &hook_declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(hook_call)) = &hook_declarator.init else {
                continue;
            };
            let Expression::Identifier(hook_identifier) = &hook_call.callee else {
                continue;
            };
            if !CONTINUOUS_VALUE_HOOK_PREFIXES
                .iter()
                .any(|prefix| hook_identifier.name.starts_with(prefix))
            {
                continue;
            }
            let mut threshold_declarator_spans = Vec::new();
            for following_statement in &component_body.statements[statement_index + 1..] {
                let Statement::VariableDeclaration(declaration) = following_statement else {
                    break;
                };
                for declarator in &declaration.declarations {
                    if declarator.init.as_ref().is_some_and(|initializer| {
                        derived_hook_is_threshold_comparison(
                            initializer,
                            continuous_binding.name.as_str(),
                        )
                    }) {
                        threshold_declarator_spans.push(declarator.span);
                    }
                }
            }
            if threshold_declarator_spans.is_empty()
                || continuous_hook_is_referenced_elsewhere(
                    component_body.span,
                    hook_declarator,
                    &threshold_declarator_spans,
                    continuous_binding.name.as_str(),
                    identifier_node_ids_by_start,
                    ctx,
                )
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This redraws the screen far more than needed because {}() changes constantly but you only check it against a cutoff, so use a threshold hook like `useMediaQuery(\"(max-width: 767px)\")` to redraw only when the answer changes",
                    hook_identifier.name
                ))
                .with_label(hook_declarator.span),
            );
        }
    }
}

fn derived_hook_is_threshold_comparison(expression: &Expression<'_>, value_name: &str) -> bool {
    let Expression::BinaryExpression(binary_expression) = expression else {
        return false;
    };
    if !matches!(
        binary_expression.operator,
        BinaryOperator::LessThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::GreaterEqualThan
            | BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) {
        return false;
    }
    let references_continuous_value = matches!(&binary_expression.left, Expression::Identifier(identifier) if identifier.name == value_name)
        || matches!(&binary_expression.right, Expression::Identifier(identifier) if identifier.name == value_name);
    references_continuous_value
        && (binary_expression.left.is_literal() || binary_expression.right.is_literal())
}

fn continuous_hook_is_referenced_elsewhere(
    component_body_span: Span,
    hook_declarator: &VariableDeclarator<'_>,
    threshold_declarator_spans: &[Span],
    continuous_name: &str,
    identifier_node_ids_by_start: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    let first_candidate_index = identifier_node_ids_by_start.partition_point(|node_id| {
        ctx.nodes().get_node(*node_id).span().start < component_body_span.start
    });
    identifier_node_ids_by_start[first_candidate_index..]
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .take_while(|candidate| candidate.span().start <= component_body_span.end)
        .any(|candidate| {
            let identifier_name = match candidate.kind() {
                AstKind::IdentifierReference(identifier) => identifier.name.as_str(),
                AstKind::BindingIdentifier(identifier) => identifier.name.as_str(),
                AstKind::IdentifierName(identifier) => identifier.name.as_str(),
                _ => return false,
            };
            if identifier_name != continuous_name
                || !component_body_span.contains_inclusive(candidate.span())
                || hook_declarator.span.contains_inclusive(candidate.span())
                || threshold_declarator_spans
                    .iter()
                    .any(|span| span.contains_inclusive(candidate.span()))
            {
                return false;
            }
            let parent = ctx.nodes().parent_node(candidate.id());
            if matches!(parent.kind(), AstKind::StaticMemberExpression(member) if member.property.span == candidate.span())
            {
                return false;
            }
            !matches!(parent.kind(), AstKind::ObjectProperty(property) if !property.computed && property.key.span() == candidate.span())
        })
}

fn derived_hook_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
