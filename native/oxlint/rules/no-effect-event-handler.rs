use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, FunctionType, MemberExpression, ObjectPropertyKind, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan as _, Span};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_EVENT_HANDLER_MESSAGE: &str =
    "This useEffect is simulating an event handler, which costs an extra render & runs late.";
const EFFECT_EVENT_HANDLER_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const EFFECT_EVENT_HANDLER_DIRECT_CALLEES: [&str; 16] = [
    "fetch",
    "ky",
    "got",
    "wretch",
    "ofetch",
    "post",
    "put",
    "patch",
    "navigate",
    "navigateTo",
    "showNotification",
    "toast",
    "alert",
    "confirm",
    "logVisit",
    "captureEvent",
];
const EFFECT_EVENT_HANDLER_MEMBER_METHODS: [&str; 8] = [
    "post", "put", "patch", "delete", "navigate", "capture", "track", "logEvent",
];
const EFFECT_EVENT_HANDLER_NAVIGATION_METHODS: [&str; 2] = ["push", "replace"];
const EFFECT_EVENT_HANDLER_NAVIGATION_RECEIVERS: [&str; 5] =
    ["router", "navigation", "navigator", "history", "location"];
const EFFECT_EVENT_HANDLER_CLASS_LIST_METHODS: [&str; 3] = ["add", "remove", "toggle"];
const EFFECT_EVENT_HANDLER_DOCUMENT_TARGETS: [&str; 2] = ["body", "documentElement"];

#[derive(Debug, Default, Clone)]
pub struct NoEffectEventHandler;

declare_oxc_lint!(
    /// Warns when an effect simulates an event handler through a component prop.
    NoEffectEventHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect used as an event handler.",
);

#[derive(Clone)]
struct EffectEventGuard<'a> {
    expression: &'a Expression<'a>,
    root_name: String,
    equality_other_root: Option<String>,
    is_equality_to_literal: bool,
}

impl Rule for NoEffectEventHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if effect_call.arguments.len() < 2
                || !is_react_hook_call(effect_call, &EFFECT_EVENT_HANDLER_HOOK_NAMES, ctx)
            {
                continue;
            }
            let Some(component_id) = effect_event_handler_component_id(effect_node, ctx) else {
                continue;
            };
            let prop_names = effect_event_handler_component_prop_names(component_id, ctx);
            if prop_names.is_empty() {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = effect_event_handler_callback_id(
                callback_expression,
                ctx,
                &mut function_resolution_cache,
            ) else {
                continue;
            };
            let callback_node = ctx.nodes().get_node(callback_id);
            let callback_statements = match callback_node.kind() {
                AstKind::Function(function) => {
                    let Some(body) = &function.body else {
                        continue;
                    };
                    &body.statements
                }
                AstKind::ArrowFunctionExpression(function) => {
                    let Some(body) = function.body.as_function_body() else {
                        continue;
                    };
                    &body.statements
                }
                _ => continue,
            };
            if effect_event_handler_has_cleanup(callback_id, ctx) {
                continue;
            }
            let Some(Expression::ArrayExpression(dependencies)) = effect_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if dependencies.elements.is_empty() {
                continue;
            }
            let dependency_expressions = dependencies
                .elements
                .iter()
                .filter_map(|element| element.as_expression())
                .collect::<Vec<_>>();
            let statements = callback_statements
                .iter()
                .filter(|statement| !is_no_op_statement(statement))
                .collect::<Vec<_>>();
            let Some(Statement::IfStatement(first_guard)) = statements.first().copied() else {
                continue;
            };

            let mut initial_guards = Vec::new();
            effect_event_handler_collect_guards(&first_guard.test, None, &mut initial_guards);
            let mut leading_guards = effect_event_handler_leading_guards(&statements);
            if leading_guards.is_empty() {
                leading_guards.extend(initial_guards.iter().cloned());
            }
            let matching_prop_guards = initial_guards
                .iter()
                .filter(|guard| {
                    effect_event_handler_guard_matches_dependencies(
                        guard,
                        &dependency_expressions,
                        ctx,
                    ) && prop_names.contains(&guard.root_name)
                })
                .cloned()
                .collect::<Vec<_>>();
            if matching_prop_guards.is_empty() {
                continue;
            }

            let is_single_guarded_event = statements.len() == 1
                && effect_event_handler_has_event_like_span(first_guard.consequent.span(), ctx);
            let is_early_return_event = statements.len() > 1
                && first_guard.alternate.is_none()
                && effect_event_handler_is_return_only(&first_guard.consequent)
                && statements[1..].iter().any(|statement| {
                    !matches!(statement, Statement::ReturnStatement(_))
                        && effect_event_handler_has_event_like_span(statement.span(), ctx)
                });
            if !is_single_guarded_event && !is_early_return_event {
                continue;
            }
            if is_early_return_event
                && !is_single_guarded_event
                && matching_prop_guards
                    .iter()
                    .all(|guard| guard.is_equality_to_literal)
            {
                continue;
            }

            if initial_guards.iter().any(|guard| {
                !matching_prop_guards
                    .iter()
                    .any(|matching| std::ptr::eq(matching.expression, guard.expression))
            }) {
                let matching_prop_roots = matching_prop_guards
                    .iter()
                    .map(|guard| guard.root_name.clone())
                    .collect::<FxHashSet<_>>();
                let event_region_references_prop = if is_single_guarded_event {
                    effect_event_handler_event_calls_reference_roots(
                        first_guard.consequent.span(),
                        &matching_prop_roots,
                        ctx,
                    )
                } else {
                    statements[1..].iter().any(|statement| {
                        effect_event_handler_event_calls_reference_roots(
                            statement.span(),
                            &matching_prop_roots,
                            ctx,
                        )
                    })
                };
                if !event_region_references_prop {
                    continue;
                }
            }

            if is_early_return_event {
                let reconciliation_roots = leading_guards
                    .iter()
                    .filter(|guard| {
                        !prop_names.contains(&guard.root_name)
                            && effect_event_handler_guard_has_aliased_dependency(
                                guard,
                                &dependency_expressions,
                                ctx,
                            )
                            && leading_guards.iter().any(|comparison| {
                                comparison.root_name == guard.root_name
                                    && comparison
                                        .equality_other_root
                                        .as_ref()
                                        .is_some_and(|root| prop_names.contains(root))
                            })
                    })
                    .map(|guard| guard.root_name.clone())
                    .collect::<FxHashSet<_>>();
                if !reconciliation_roots.is_empty() {
                    let matching_prop_roots = matching_prop_guards
                        .iter()
                        .map(|guard| guard.root_name.clone())
                        .collect::<FxHashSet<_>>();
                    let triggered_statements = statements[1..]
                        .iter()
                        .filter(|statement| {
                            effect_event_handler_has_event_like_span(statement.span(), ctx)
                        })
                        .copied()
                        .collect::<Vec<_>>();
                    if !triggered_statements.is_empty()
                        && triggered_statements.iter().all(|statement| {
                            effect_event_handler_is_router_replacement(
                                statement.span(),
                                &reconciliation_roots,
                                ctx,
                            )
                        })
                        && !statements[1..].iter().any(|statement| {
                            effect_event_handler_event_calls_reference_roots(
                                statement.span(),
                                &matching_prop_roots,
                                ctx,
                            )
                        })
                    {
                        continue;
                    }
                }
            }

            ctx.diagnostic(
                OxcDiagnostic::warn(EFFECT_EVENT_HANDLER_MESSAGE).with_label(effect_call.span),
            );
        }
    }
}

fn effect_event_handler_component_id(
    effect_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(effect_node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .filter(|function| effect_event_handler_is_component(function, ctx))
        .map(AstNode::id)
}

fn effect_event_handler_is_component<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function.id.as_ref().is_none_or(|identifier| {
            identifier.name == "default"
                || identifier
                    .name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
        }) || matches!(
            ctx.nodes().parent_node(function_node.id()).kind(),
            AstKind::ExportDefaultDeclaration(_)
        );
    }
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let mut current = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if matches!(parent.kind(), AstKind::CallExpression(_)) {
            current = transparent_expression_root(parent, ctx);
            continue;
        }
        return match parent.kind() {
            AstKind::VariableDeclarator(declarator) => declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| {
                    identifier
                        .name
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase)
                }),
            AstKind::ExportDefaultDeclaration(_) => true,
            _ => false,
        };
    }
}

fn effect_event_handler_component_prop_names(
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    match ctx.nodes().get_node(component_id).kind() {
        AstKind::Function(function) => {
            for parameter in &function.params.items {
                collect_binding_pattern_names(&parameter.pattern, &mut names);
            }
        }
        AstKind::ArrowFunctionExpression(function) => {
            for parameter in &function.params.items {
                collect_binding_pattern_names(&parameter.pattern, &mut names);
            }
        }
        _ => {}
    }
    names
}

fn effect_event_handler_callback_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        function_resolution_cache,
    )
}

fn effect_event_handler_has_cleanup(callback_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::ReturnStatement(statement) = node.kind() else {
            return false;
        };
        effect_event_handler_nearest_function_id(node.id(), ctx) == Some(callback_id)
            && statement
                .argument
                .as_ref()
                .is_some_and(|argument| effect_event_handler_is_cleanup_value(argument, ctx))
    })
}

fn effect_event_handler_is_cleanup_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        expression if expression.as_member_expression().is_some() => true,
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                let declaration = ctx.symbol_declaration(symbol_id);
                ctx.nodes().ancestors(declaration.id()).any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::FormalParameter(_) | AstKind::FormalParameters(_)
                    )
                }) || matches!(declaration.kind(), AstKind::Function(_))
                    || matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| matches!(
                        initializer.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )))
            }),
        Expression::ConditionalExpression(conditional) => {
            effect_event_handler_is_cleanup_value(&conditional.consequent, ctx)
                || effect_event_handler_is_cleanup_value(&conditional.alternate, ctx)
        }
        _ => false,
    }
}

fn effect_event_handler_nearest_function_id(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn effect_event_handler_collect_guards<'a>(
    expression: &'a Expression<'a>,
    equality_context: Option<(&Expression<'a>, BinaryOperator)>,
    guards: &mut Vec<EffectEventGuard<'a>>,
) {
    let expression = expression.get_inner_expression();
    if let Some(root_name) = effect_event_handler_root_name(expression) {
        let equality_other_root = equality_context.and_then(|(other, operator)| {
            matches!(
                operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            )
            .then(|| effect_event_handler_root_name(other).map(str::to_string))
            .flatten()
        });
        let is_equality_to_literal = equality_context.is_some_and(|(other, operator)| {
            matches!(
                operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) && matches!(
                other.get_inner_expression(),
                Expression::StringLiteral(_)
                    | Expression::NumericLiteral(_)
                    | Expression::BooleanLiteral(_)
                    | Expression::NullLiteral(_)
                    | Expression::TemplateLiteral(_)
            )
        });
        guards.push(EffectEventGuard {
            expression,
            root_name: root_name.to_string(),
            equality_other_root,
            is_equality_to_literal,
        });
        return;
    }
    match expression {
        Expression::UnaryExpression(unary) => {
            effect_event_handler_collect_guards(&unary.argument, None, guards);
        }
        Expression::BinaryExpression(binary) => {
            effect_event_handler_collect_guards(
                &binary.left,
                Some((&binary.right, binary.operator)),
                guards,
            );
            effect_event_handler_collect_guards(
                &binary.right,
                Some((&binary.left, binary.operator)),
                guards,
            );
        }
        Expression::LogicalExpression(logical) => {
            effect_event_handler_collect_guards(&logical.left, None, guards);
            effect_event_handler_collect_guards(&logical.right, None, guards);
        }
        Expression::ConditionalExpression(conditional) => {
            effect_event_handler_collect_guards(&conditional.test, None, guards);
            effect_event_handler_collect_guards(&conditional.consequent, None, guards);
            effect_event_handler_collect_guards(&conditional.alternate, None, guards);
        }
        _ => {}
    }
}

fn effect_event_handler_leading_guards<'a>(
    statements: &[&'a Statement<'a>],
) -> Vec<EffectEventGuard<'a>> {
    let mut guards = Vec::new();
    for statement in statements {
        if matches!(statement, Statement::VariableDeclaration(_)) {
            continue;
        }
        let Statement::IfStatement(if_statement) = statement else {
            break;
        };
        if if_statement.alternate.is_some()
            || !effect_event_handler_is_return_only(&if_statement.consequent)
        {
            break;
        }
        effect_event_handler_collect_guards(&if_statement.test, None, &mut guards);
    }
    guards
}

fn effect_event_handler_is_return_only(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_) => true,
        Statement::BlockStatement(block) => {
            matches!(block.body.as_slice(), [Statement::ReturnStatement(_)])
        }
        _ => false,
    }
}

fn effect_event_handler_guard_matches_dependencies<'a>(
    guard: &EffectEventGuard<'a>,
    dependencies: &[&Expression<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    dependencies.iter().any(|dependency| {
        effect_event_handler_expressions_equal(guard.expression, dependency, ctx)
            || matches!(dependency.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name.as_str() == guard.root_name.as_str())
    })
}

fn effect_event_handler_guard_has_aliased_dependency<'a, 'b>(
    guard: &'b EffectEventGuard<'a>,
    dependencies: &[&'b Expression<'a>],
    ctx: &'b LintContext<'a>,
) -> bool {
    let guard_origins = effect_event_handler_immutable_origins(guard.expression, ctx);
    dependencies.iter().any(|dependency| {
        let dependency_origins = effect_event_handler_immutable_origins(dependency, ctx);
        guard_origins.iter().any(|guard_origin| {
            dependency_origins.iter().any(|dependency_origin| {
                effect_event_handler_expressions_equal(guard_origin, dependency_origin, ctx)
            })
        })
    })
}

fn effect_event_handler_immutable_origins<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> Vec<&'b Expression<'a>> {
    let mut origins = Vec::new();
    let mut current = expression.get_inner_expression();
    let mut visited = FxHashSet::default();
    loop {
        origins.push(current);
        let Expression::Identifier(identifier) = current else {
            break;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            break;
        };
        if !visited.insert(symbol_id) {
            break;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            break;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            break;
        }
        let parent = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            break;
        };
        if !variable_declaration.kind.is_const() {
            break;
        }
        let Some(initializer) = &declarator.init else {
            break;
        };
        current = initializer.get_inner_expression();
    }
    origins
}

fn effect_event_handler_root_name<'a, 'b>(expression: &'b Expression<'a>) -> Option<&'b str> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression if expression.as_member_expression().is_some() => {
            effect_event_handler_root_name(expression.as_member_expression()?.object())
        }
        Expression::ChainExpression(chain) => chain
            .expression
            .as_member_expression()
            .and_then(|member| effect_event_handler_root_name(member.object())),
        _ => None,
    }
}

fn effect_event_handler_expressions_equal<'a>(
    first: &Expression<'a>,
    second: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let first = first.get_inner_expression();
    let second = second.get_inner_expression();
    match (first, second) {
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            let first_symbol = ctx
                .scoping()
                .get_reference(first.reference_id())
                .symbol_id();
            let second_symbol = ctx
                .scoping()
                .get_reference(second.reference_id())
                .symbol_id();
            match (first_symbol, second_symbol) {
                (Some(first), Some(second)) => first == second,
                (None, None) => first.name == second.name,
                _ => false,
            }
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
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::UnaryExpression(first), Expression::UnaryExpression(second)) => {
            first.operator == second.operator
                && effect_event_handler_expressions_equal(&first.argument, &second.argument, ctx)
        }
        (Expression::BinaryExpression(first), Expression::BinaryExpression(second)) => {
            first.operator == second.operator
                && effect_event_handler_expressions_equal(&first.left, &second.left, ctx)
                && effect_event_handler_expressions_equal(&first.right, &second.right, ctx)
        }
        (Expression::LogicalExpression(first), Expression::LogicalExpression(second)) => {
            first.operator == second.operator
                && effect_event_handler_expressions_equal(&first.left, &second.left, ctx)
                && effect_event_handler_expressions_equal(&first.right, &second.right, ctx)
        }
        (Expression::ChainExpression(first), Expression::ChainExpression(second)) => {
            let (Some(first_member), Some(second_member)) = (
                first.expression.as_member_expression(),
                second.expression.as_member_expression(),
            ) else {
                return false;
            };
            effect_event_handler_member_expressions_equal(first_member, second_member, ctx)
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            first.arguments.len() == second.arguments.len()
                && effect_event_handler_expressions_equal(&first.callee, &second.callee, ctx)
                && first
                    .arguments
                    .iter()
                    .zip(&second.arguments)
                    .all(
                        |(first, second)| match (first.as_expression(), second.as_expression()) {
                            (Some(first), Some(second)) => {
                                effect_event_handler_expressions_equal(first, second, ctx)
                            }
                            _ => false,
                        },
                    )
        }
        (first, second) => {
            let (Some(first_member), Some(second_member)) =
                (first.as_member_expression(), second.as_member_expression())
            else {
                return false;
            };
            effect_event_handler_member_expressions_equal(first_member, second_member, ctx)
        }
    }
}

fn effect_event_handler_member_expressions_equal<'a>(
    first: &MemberExpression<'a>,
    second: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match (first, second) {
        (
            MemberExpression::StaticMemberExpression(first),
            MemberExpression::StaticMemberExpression(second),
        ) => {
            first.property.name == second.property.name
                && effect_event_handler_expressions_equal(&first.object, &second.object, ctx)
        }
        (
            MemberExpression::ComputedMemberExpression(first),
            MemberExpression::ComputedMemberExpression(second),
        ) => {
            effect_event_handler_expressions_equal(&first.object, &second.object, ctx)
                && effect_event_handler_expressions_equal(
                    &first.expression,
                    &second.expression,
                    ctx,
                )
        }
        _ => false,
    }
}

fn effect_event_handler_has_event_like_span(span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        span.contains_inclusive(call.span)
            && (effect_event_handler_is_triggered_call(call)
                || effect_event_handler_is_document_class_list_call(call))
    })
}

fn effect_event_handler_is_triggered_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            EFFECT_EVENT_HANDLER_DIRECT_CALLEES.contains(&identifier.name.as_str())
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            EFFECT_EVENT_HANDLER_MEMBER_METHODS.contains(&method_name)
                || (EFFECT_EVENT_HANDLER_NAVIGATION_METHODS.contains(&method_name)
                    && effect_event_handler_root_name(member.object()).is_some_and(|root| {
                        EFFECT_EVENT_HANDLER_NAVIGATION_RECEIVERS.contains(&root)
                    }))
        }
    }
}

fn effect_event_handler_is_document_class_list_call(
    call: &oxc_ast::ast::CallExpression<'_>,
) -> bool {
    let Some(method) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if !method
        .static_property_name()
        .is_some_and(|name| EFFECT_EVENT_HANDLER_CLASS_LIST_METHODS.contains(&name))
    {
        return false;
    }
    let Some(class_list) = method
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if class_list.static_property_name() != Some("classList") {
        return false;
    }
    let Some(document_target) = class_list
        .object()
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    document_target
        .static_property_name()
        .is_some_and(|name| EFFECT_EVENT_HANDLER_DOCUMENT_TARGETS.contains(&name))
        && matches!(document_target.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "document")
}

fn effect_event_handler_event_calls_reference_roots(
    span: Span,
    roots: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        span.contains_inclusive(call.span)
            && (effect_event_handler_is_triggered_call(call)
                || effect_event_handler_is_document_class_list_call(call))
            && effect_event_handler_span_references_roots(call.span, roots, ctx)
    })
}

fn effect_event_handler_span_references_roots(
    span: Span,
    roots: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        matches!(node.kind(), AstKind::IdentifierReference(identifier)
            if span.contains_inclusive(identifier.span) && roots.contains(identifier.name.as_str()))
    })
}

fn effect_event_handler_is_router_replacement(
    span: Span,
    reconciliation_roots: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut found_navigation = false;
    let mut found_other_trigger = false;
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if !span.contains_inclusive(call.span)
            || (!effect_event_handler_is_triggered_call(call)
                && !effect_event_handler_is_document_class_list_call(call))
        {
            continue;
        }
        let destination_references_reconciliation = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|destination| {
                effect_event_handler_immutable_origins(destination, ctx)
                    .iter()
                    .any(|origin| {
                        effect_event_handler_expression_references_roots(
                            origin,
                            reconciliation_roots,
                            ctx,
                        )
                    })
            });
        let Expression::Identifier(navigate_identifier) = call.callee.get_inner_expression() else {
            found_other_trigger = true;
            continue;
        };
        if !destination_references_reconciliation
            || !effect_event_handler_is_router_navigate_binding(navigate_identifier, ctx)
            || !call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .is_some_and(|options| effect_event_handler_replace_is_true(options, ctx))
        {
            found_other_trigger = true;
            continue;
        }
        found_navigation = true;
    }
    found_navigation && !found_other_trigger
}

fn effect_event_handler_expression_references_roots(
    expression: &Expression<'_>,
    roots: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    effect_event_handler_span_references_roots(expression.span(), roots, ctx)
}

fn effect_event_handler_is_router_navigate_binding(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const() {
        return false;
    }
    let Some(Expression::CallExpression(hook_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::Identifier(hook_identifier) = hook_call.callee.get_inner_expression() else {
        return false;
    };
    direct_named_import_matches(
        hook_identifier,
        &["useNavigate"],
        &["react-router-dom", "react-router"],
        ctx,
    )
}

fn effect_event_handler_replace_is_true<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return false;
    };
    let mut is_replace_true = false;
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            is_replace_true = false;
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            is_replace_true = false;
            continue;
        };
        if property_name == "replace" {
            is_replace_true = effect_event_handler_is_statically_true(&property.value, ctx);
        }
    }
    is_replace_true
}

fn effect_event_handler_is_statically_true<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    effect_event_handler_immutable_origins(expression, ctx)
        .iter()
        .any(|origin| matches!(origin.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value))
}
