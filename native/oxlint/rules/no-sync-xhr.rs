use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, ClassElement, Expression, MemberExpression, MethodDefinitionKind,
        TSSignature, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "A synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes, blocking all rendering and input. Use `fetch()` or an async XHR (`open(method, url, true)`).";

#[derive(Debug, Default, Clone)]
pub struct NoSyncXhr;

declare_oxc_lint!(
    /// Disallow synchronous XMLHttpRequest calls.
    NoSyncXhr,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow synchronous XMLHttpRequest calls.",
);

impl Rule for NoSyncXhr {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        !format!("/{filename}")
            .to_ascii_lowercase()
            .contains("/public/")
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mutation_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(MemberExpression::StaticMemberExpression(member_expression)) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                continue;
            };
            if member_expression.property.name != "open"
                || call_expression.arguments.len() < 3
                || !matches!(
                    call_expression
                        .arguments
                        .get(2)
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .map(Expression::get_inner_expression),
                    Some(Expression::BooleanLiteral(literal)) if !literal.value
                )
                || !sync_xhr_is_proven_receiver(&member_expression.object, ctx, &mut Vec::new())
            {
                continue;
            }
            if let Expression::Identifier(identifier) =
                member_expression.object.get_inner_expression()
                && sync_xhr_has_identifier_method_mutation_before(
                    identifier,
                    node,
                    &mutation_analysis,
                    ctx,
                )
            {
                continue;
            }
            if sync_xhr_has_this_field_replacement_before(
                &member_expression.object,
                node,
                &mutation_analysis,
                ctx,
            ) {
                continue;
            }
            if sync_xhr_factory_returns_mutated_receiver(
                &member_expression.object,
                &mutation_analysis,
                ctx,
            ) {
                continue;
            }
            if sync_xhr_has_prototype_open_replacement_before(node, &mutation_analysis, ctx) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn sync_xhr_has_identifier_method_mutation_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    let alias_symbol_ids = potential_alias_symbol_ids(root_symbol_id, ctx);
    let alias_symbol_set = alias_symbol_ids
        .iter()
        .copied()
        .collect::<rustc_hash::FxHashSet<_>>();
    let escape_symbol_set = sync_xhr_escape_container_symbol_ids(&alias_symbol_set, ctx);
    let mut mutation_node_ids = rustc_hash::FxHashSet::default();
    for symbol_id in alias_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            if let Some(member_node) = static_property_write_member(identifier_node, ctx)
                && resolved_static_member_property_name(member_node, ctx).as_deref() == Some("open")
            {
                mutation_node_ids.insert(member_node.id());
                continue;
            }
            let expression_root = transparent_expression_root(identifier_node, ctx);
            let parent = ctx.nodes().parent_node(expression_root.id());
            let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                continue;
            };
            if assignment.left.span() != expression_root.span()
                || sync_xhr_is_proven_receiver(&assignment.right, ctx, &mut Vec::new())
            {
                continue;
            }
            mutation_node_ids.insert(parent.id());
        }
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if sync_xhr_is_define_property_call_for_alias(call_expression, &alias_symbol_set, ctx) {
            mutation_node_ids.insert(candidate.id());
        }
        if candidate.id() != call_node.id()
            && call_expression
                .arguments
                .iter()
                .enumerate()
                .any(|(argument_index, argument)| {
                    argument.as_expression().is_some_and(|argument| {
                        sync_xhr_expression_contains_alias(argument, &escape_symbol_set, ctx)
                            && sync_xhr_call_may_mutate_argument(
                                call_expression,
                                argument_index,
                                ctx,
                                &mut rustc_hash::FxHashSet::default(),
                            )
                    })
                })
        {
            mutation_node_ids.insert(candidate.id());
        }
    }
    let mutation_nodes = mutation_node_ids
        .into_iter()
        .map(|node_id| ctx.nodes().get_node(node_id))
        .collect::<Vec<_>>();
    sync_xhr_mutations_dominate_call(&mutation_nodes, call_node, analysis, ctx)
}

fn sync_xhr_escape_container_symbol_ids(
    receiver_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<SymbolId> {
    let mut symbol_ids = receiver_symbol_ids.clone();
    loop {
        let mut did_add_symbol = false;
        for candidate in ctx.nodes().iter() {
            let container_symbol_id = match candidate.kind() {
                AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| {
                        sync_xhr_expression_contains_alias(initializer, &symbol_ids, ctx)
                            || matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
                                if call.arguments.iter().enumerate().any(|(argument_index, argument)| {
                                    argument.as_expression().is_some_and(|argument| {
                                        sync_xhr_expression_contains_alias(argument, &symbol_ids, ctx)
                                    }) && sync_xhr_call_returns_argument(call, argument_index, ctx)
                                }))
                    }) =>
                {
                    declarator
                        .id
                        .get_binding_identifier()
                        .map(|identifier| identifier.symbol_id())
                }
                AstKind::AssignmentExpression(assignment)
                    if sync_xhr_expression_contains_alias(&assignment.right, &symbol_ids, ctx) =>
                {
                    assignment
                        .left
                        .as_member_expression()
                        .and_then(|member| match member.object().get_inner_expression() {
                            Expression::Identifier(identifier) => ctx
                                .scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id(),
                            _ => None,
                        })
                }
                _ => None,
            };
            if container_symbol_id.is_some_and(|symbol_id| symbol_ids.insert(symbol_id)) {
                did_add_symbol = true;
            }
        }
        if !did_add_symbol {
            return symbol_ids;
        }
    }
}

fn sync_xhr_call_returns_argument(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    argument_index: usize,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = sync_xhr_local_called_function_id(call_expression, ctx) else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_id);
    if matches!(function_node.kind(), AstKind::Function(function) if function.generator) {
        return false;
    }
    let parameter_symbol_id = match function_node.kind() {
        AstKind::Function(function) => function.params.items.get(argument_index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(argument_index),
        _ => None,
    }
    .and_then(|parameter| parameter.pattern.get_binding_identifier())
    .map(|identifier| identifier.symbol_id());
    let Some(parameter_symbol_id) = parameter_symbol_id else {
        return false;
    };
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id)
                && matches!(candidate.kind(), AstKind::ReturnStatement(_))
        })
        .collect::<Vec<_>>();
    if !return_nodes.is_empty() {
        return return_nodes.iter().all(|return_node| {
            matches!(return_node.kind(), AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().is_some_and(|expression| {
                matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
                    if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                        == Some(parameter_symbol_id))
            }))
        });
    }
    matches!(function_node.kind(), AstKind::ArrowFunctionExpression(function)
    if function.get_expression().is_some_and(|expression| {
        matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
            if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                == Some(parameter_symbol_id))
    }))
}

fn sync_xhr_expression_contains_alias(
    expression: &Expression<'_>,
    alias_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| alias_symbol_ids.contains(&symbol_id)),
        Expression::ObjectExpression(object) => {
            object.properties.iter().any(|property| match property {
                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                    sync_xhr_expression_contains_alias(&property.value, alias_symbol_ids, ctx)
                }
                oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread) => {
                    sync_xhr_expression_contains_alias(&spread.argument, alias_symbol_ids, ctx)
                }
            })
        }
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                sync_xhr_expression_contains_alias(&spread.argument, alias_symbol_ids, ctx)
            }
            element => element.as_expression().is_some_and(|expression| {
                sync_xhr_expression_contains_alias(expression, alias_symbol_ids, ctx)
            }),
        }),
        _ => false,
    }
}

fn sync_xhr_call_may_mutate_argument(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    argument_index: usize,
    ctx: &LintContext<'_>,
    visited_function_parameters: &mut rustc_hash::FxHashSet<(oxc_semantic::NodeId, usize)>,
) -> bool {
    let Some(function_id) = sync_xhr_local_called_function_id(call_expression, ctx) else {
        return true;
    };
    if !visited_function_parameters.insert((function_id, argument_index)) {
        return false;
    }
    let function_node = ctx.nodes().get_node(function_id);
    if matches!(function_node.kind(), AstKind::Function(function) if function.generator) {
        return false;
    }
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.get(argument_index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(argument_index),
        _ => None,
    };
    let Some(parameter_symbol_id) = parameter
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(|identifier| identifier.symbol_id())
    else {
        return true;
    };
    let alias_symbol_ids = potential_alias_symbol_ids(parameter_symbol_id, ctx);
    let alias_symbol_set = alias_symbol_ids
        .iter()
        .copied()
        .collect::<rustc_hash::FxHashSet<_>>();
    for symbol_id in alias_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            if static_property_write_member(identifier_node, ctx).is_some() {
                return true;
            }
            for ancestor in ctx.nodes().ancestors(identifier_node.id()) {
                if ancestor.id() == function_id {
                    break;
                }
                match ancestor.kind() {
                    AstKind::AssignmentExpression(_) => return true,
                    AstKind::ReturnStatement(_) => {}
                    AstKind::CallExpression(inner_call) => {
                        if let Some(inner_argument_index) =
                            inner_call.arguments.iter().position(|argument| {
                                argument.as_expression().is_some_and(|argument| {
                                    sync_xhr_expression_contains_alias(
                                        argument,
                                        &alias_symbol_set,
                                        ctx,
                                    )
                                })
                            })
                        {
                            if sync_xhr_call_may_mutate_argument(
                                inner_call,
                                inner_argument_index,
                                ctx,
                                visited_function_parameters,
                            ) {
                                return true;
                            }
                        }
                    }
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
                    _ => {}
                }
            }
        }
    }
    false
}

fn sync_xhr_is_define_property_call_for_alias(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    alias_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if member.static_property_name() != Some("defineProperty")
        || !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Object" | "Reflect")
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        || !matches!(
            call_expression
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::StringLiteral(literal)) if literal.value == "open"
        )
    {
        return false;
    }
    let Some(Expression::Identifier(target)) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(target.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| alias_symbol_ids.contains(&symbol_id))
}

fn sync_xhr_mutations_dominate_call<'a>(
    mutation_nodes: &[&AstNode<'a>],
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    mutation_nodes.iter().any(|mutation_node| {
        sync_xhr_mutation_dominates_call(
            mutation_node,
            call_node,
            analysis,
            ctx,
            &mut rustc_hash::FxHashSet::default(),
        )
    }) || sync_xhr_mutations_collectively_dominate_call(mutation_nodes, call_node, ctx)
}

fn sync_xhr_mutation_dominates_call<'a>(
    mutation_node: &AstNode<'a>,
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_pairs: &mut rustc_hash::FxHashSet<(oxc_semantic::NodeId, oxc_semantic::NodeId)>,
) -> bool {
    if !visited_pairs.insert((mutation_node.id(), call_node.id())) {
        return false;
    }
    let mutation_owner = execution_boundary(mutation_node, ctx);
    let call_owner = execution_boundary(call_node, ctx);
    if mutation_owner.id() == call_owner.id() {
        return node_dominates_node(mutation_node, call_node, ctx);
    }
    if sync_xhr_is_constructor_mutation_for_call(mutation_node, call_node, ctx) {
        return true;
    }
    let mutation_contains_call = mutation_owner.span().contains_inclusive(call_owner.span());
    let call_contains_mutation = call_owner.span().contains_inclusive(mutation_owner.span());
    if mutation_contains_call {
        let Some(call_invocations) = analysis.calls_by_function.get(&call_owner.id()) else {
            return matches!(mutation_owner.kind(), AstKind::Program(_))
                && node_is_on_unconditional_path(mutation_node, mutation_owner, ctx);
        };
        return !call_invocations.is_empty()
            && call_invocations.iter().all(|invocation_id| {
                sync_xhr_mutation_dominates_call(
                    mutation_node,
                    ctx.nodes().get_node(*invocation_id),
                    analysis,
                    ctx,
                    &mut visited_pairs.clone(),
                )
            });
    }
    if call_contains_mutation {
        return node_is_on_unconditional_path(mutation_node, mutation_owner, ctx)
            && analysis
                .calls_by_function
                .get(&mutation_owner.id())
                .is_some_and(|invocations| {
                    invocations.iter().any(|invocation_id| {
                        sync_xhr_mutation_dominates_call(
                            ctx.nodes().get_node(*invocation_id),
                            call_node,
                            analysis,
                            ctx,
                            &mut visited_pairs.clone(),
                        )
                    })
                });
    }
    if !node_is_on_unconditional_path(mutation_node, mutation_owner, ctx) {
        return false;
    }
    let Some(mutation_invocations) = analysis.calls_by_function.get(&mutation_owner.id()) else {
        return false;
    };
    let Some(call_invocations) = analysis.calls_by_function.get(&call_owner.id()) else {
        return false;
    };
    !call_invocations.is_empty()
        && call_invocations.iter().all(|call_invocation_id| {
            let call_invocation = ctx.nodes().get_node(*call_invocation_id);
            sync_xhr_mutation_dominates_call(
                mutation_node,
                call_invocation,
                analysis,
                ctx,
                &mut visited_pairs.clone(),
            ) || mutation_invocations.iter().any(|mutation_invocation_id| {
                sync_xhr_mutation_dominates_call(
                    ctx.nodes().get_node(*mutation_invocation_id),
                    call_invocation,
                    analysis,
                    ctx,
                    &mut visited_pairs.clone(),
                )
            })
        })
}

fn sync_xhr_is_constructor_mutation_for_call<'a>(
    mutation_node: &AstNode<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(class_id) = sync_xhr_nearest_class_id(call_node.id(), ctx) else {
        return false;
    };
    !sync_xhr_is_inside_constructor(call_node.id(), ctx)
        && sync_xhr_nearest_class_id(mutation_node.id(), ctx) == Some(class_id)
        && sync_xhr_is_inside_constructor(mutation_node.id(), ctx)
        && crate::ast_util::get_enclosing_function(mutation_node, ctx).is_some_and(|constructor| {
            node_is_on_unconditional_path(mutation_node, constructor, ctx)
        })
}

fn sync_xhr_mutations_collectively_dominate_call<'a>(
    mutation_nodes: &[&AstNode<'a>],
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if mutation_nodes.len() < 2 {
        return false;
    }
    let call_owner = execution_boundary(call_node, ctx);
    if mutation_nodes
        .iter()
        .any(|mutation_node| execution_boundary(mutation_node, ctx).id() != call_owner.id())
    {
        return false;
    }
    let call_block = ctx.nodes().cfg_id(call_node.id());
    if mutation_nodes.iter().any(|mutation_node| {
        ctx.nodes().cfg_id(mutation_node.id()) == call_block
            && mutation_node.span().start < call_node.span().start
    }) {
        return true;
    }
    let mut mutation_blocks = mutation_nodes
        .iter()
        .map(|mutation_node| ctx.nodes().cfg_id(mutation_node.id()))
        .collect::<rustc_hash::FxHashSet<_>>();
    mutation_blocks.remove(&call_block);
    !cfg_block_can_reach(
        ctx.nodes().cfg_id(call_owner.id()),
        call_block,
        &mutation_blocks,
        ctx,
    )
}

fn sync_xhr_has_this_field_replacement_before<'a>(
    receiver: &Expression<'a>,
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(receiver_member) = receiver.get_inner_expression().as_member_expression() else {
        return false;
    };
    if !matches!(
        receiver_member.object().get_inner_expression(),
        Expression::ThisExpression(_)
    ) {
        return false;
    }
    let Some(property_name) = receiver_member.static_property_name() else {
        return false;
    };
    let mutation_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(target_member) = assignment.left.as_member_expression() else {
                    return false;
                };
                let replaces_receiver = target_member.static_property_name() == Some(property_name)
                    && matches!(
                        target_member.object().get_inner_expression(),
                        Expression::ThisExpression(_)
                    )
                    && !sync_xhr_is_proven_receiver(&assignment.right, ctx, &mut Vec::new());
                replaces_receiver
                    || (target_member.static_property_name() == Some("open")
                        && sync_xhr_is_this_property(target_member.object(), property_name))
            }
            AstKind::UnaryExpression(unary)
                if unary.operator == oxc_syntax::operator::UnaryOperator::Delete =>
            {
                unary
                    .argument
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|target_member| {
                        target_member.static_property_name() == Some("open")
                            && sync_xhr_is_this_property(target_member.object(), property_name)
                    })
            }
            AstKind::CallExpression(call_expression) => {
                sync_xhr_is_define_property_call_for_this_property(
                    call_expression,
                    property_name,
                    ctx,
                )
            }
            _ => false,
        })
        .collect::<Vec<_>>();
    sync_xhr_mutations_dominate_call(&mutation_nodes, call_node, analysis, ctx)
}

fn sync_xhr_is_this_property(expression: &Expression<'_>, property_name: &str) -> bool {
    expression
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| {
            member.static_property_name() == Some(property_name)
                && matches!(
                    member.object().get_inner_expression(),
                    Expression::ThisExpression(_)
                )
        })
}

fn sync_xhr_is_define_property_call_for_this_property(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    member.static_property_name() == Some("defineProperty")
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Object" | "Reflect")
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        && matches!(
            call_expression
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::StringLiteral(literal)) if literal.value == "open"
        )
        && call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|target| sync_xhr_is_this_property(target, property_name))
}

fn sync_xhr_factory_returns_mutated_receiver(
    receiver: &Expression<'_>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::CallExpression(call_expression) = receiver.get_inner_expression() else {
        return false;
    };
    let Some(function_id) = sync_xhr_local_called_function_id(call_expression, ctx) else {
        return false;
    };
    if matches!(ctx.nodes().get_node(function_id).kind(), AstKind::Function(function)
        if function.generator)
    {
        return false;
    }
    let return_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id)
                && matches!(candidate.kind(), AstKind::ReturnStatement(_))
        })
        .collect::<Vec<_>>();
    !return_nodes.is_empty()
        && return_nodes.iter().all(|return_node| {
            let AstKind::ReturnStatement(return_statement) = return_node.kind() else {
                return false;
            };
            let Some(Expression::Identifier(identifier)) = return_statement
                .argument
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            sync_xhr_has_identifier_method_mutation_before(identifier, return_node, analysis, ctx)
        })
}

fn sync_xhr_local_called_function_id(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_)
            if !ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write) =>
        {
            Some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) =>
        {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            ctx.nodes()
                .iter()
                .find(|candidate| {
                    candidate.span() == initializer.span()
                        && matches!(
                            candidate.kind(),
                            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                        )
                })
                .map(|candidate| candidate.id())
        }
        _ => None,
    }
}

fn sync_xhr_nearest_class_id(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find_map(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)).then_some(ancestor.id()))
}

fn sync_xhr_is_inside_constructor(node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::MethodDefinition(method)
                if method.kind == MethodDefinitionKind::Constructor
        )
    })
}

fn sync_xhr_is_proven_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let asserted_receiver = match expression {
        Expression::TSAsExpression(assertion) => {
            Some((&assertion.expression, &assertion.type_annotation))
        }
        Expression::TSTypeAssertion(assertion) => {
            Some((&assertion.expression, &assertion.type_annotation))
        }
        Expression::TSSatisfiesExpression(assertion) => {
            Some((&assertion.expression, &assertion.type_annotation))
        }
        _ => None,
    };
    if let Some((asserted_expression, asserted_type)) = asserted_receiver
        && sync_xhr_is_type(asserted_type, ctx)
    {
        return sync_xhr_assertion_source_is_safe(asserted_expression, ctx, visited_symbol_ids);
    }
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            is_proven_global_namespace_reference(&new_expression.callee, "XMLHttpRequest", ctx)
        }
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
            if sync_xhr_symbol_has_type(symbol_id, ctx) {
                return true;
            }
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            sync_xhr_is_proven_receiver(initializer, ctx, visited_symbol_ids)
        }
        Expression::ConditionalExpression(conditional) => {
            let mut has_receiver = false;
            for branch in [&conditional.consequent, &conditional.alternate] {
                if sync_xhr_is_nullish(branch, ctx) {
                    continue;
                }
                if !sync_xhr_is_proven_receiver(branch, ctx, &mut visited_symbol_ids.clone()) {
                    return false;
                }
                has_receiver = true;
            }
            has_receiver
        }
        Expression::CallExpression(call_expression) => {
            sync_xhr_local_factory_returns_xhr(call_expression, ctx, visited_symbol_ids)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            sync_xhr_is_proven_this_field(member, expression.node_id(), ctx, visited_symbol_ids)
        }),
    }
}

fn sync_xhr_is_proven_this_field<'a>(
    member: &oxc_ast::ast::MemberExpression<'a>,
    member_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if !matches!(
        member.object().get_inner_expression(),
        Expression::ThisExpression(_)
    ) {
        return false;
    }
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    let mut ordinary_function_count = 0;
    let mut class = None;
    for ancestor in ctx.nodes().ancestors(member_node_id) {
        match ancestor.kind() {
            AstKind::ArrowFunctionExpression(_) => {}
            AstKind::Function(_) => {
                ordinary_function_count += 1;
                if ordinary_function_count > 1 {
                    return false;
                }
            }
            AstKind::Class(candidate_class) => {
                class = Some(candidate_class);
                break;
            }
            _ => {}
        }
    }
    let Some(class) = class else {
        return false;
    };
    class.body.body.iter().any(|element| {
        let ClassElement::PropertyDefinition(property) = element else {
            return false;
        };
        if property.r#static || property.key.static_name().as_deref() != Some(property_name) {
            return false;
        }
        property
            .type_annotation
            .as_ref()
            .is_some_and(|annotation| sync_xhr_is_type(&annotation.type_annotation, ctx))
            || property.value.as_ref().is_some_and(|initializer| {
                sync_xhr_is_proven_receiver(initializer, ctx, &mut visited_symbol_ids.clone())
            })
    })
}

fn sync_xhr_assertion_source_is_safe<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if sync_xhr_is_proven_receiver(expression, ctx, &mut visited_symbol_ids.clone()) {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(_) => true,
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
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            sync_xhr_assertion_source_is_safe(initializer, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn sync_xhr_symbol_has_type(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .type_annotation
            .as_ref()
            .is_some_and(|annotation| sync_xhr_is_type(&annotation.type_annotation, ctx)),
        AstKind::FormalParameter(parameter) => {
            let Some(annotation) = &parameter.type_annotation else {
                return false;
            };
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return sync_xhr_is_type(&annotation.type_annotation, ctx);
            }
            sync_xhr_destructured_parameter_type(
                &parameter.pattern,
                symbol_id,
                &annotation.type_annotation,
                ctx,
            )
        }
        AstKind::PropertyDefinition(property) => property
            .type_annotation
            .as_ref()
            .is_some_and(|annotation| sync_xhr_is_type(&annotation.type_annotation, ctx)),
        _ => false,
    }
}

fn sync_xhr_destructured_parameter_type(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
    parameter_type: &TSType<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return false;
    };
    let Some(property_name) = pattern.properties.iter().find_map(|property| {
        sync_xhr_pattern_contains_symbol(&property.value, symbol_id)
            .then(|| property.key.static_name())
            .flatten()
    }) else {
        return false;
    };
    let TSType::TSTypeLiteral(type_literal) = parameter_type else {
        return false;
    };
    type_literal.members.iter().any(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return false;
        };
        !property.computed
            && property.key.static_name().as_deref() == Some(property_name.as_ref())
            && property
                .type_annotation
                .as_ref()
                .is_some_and(|annotation| sync_xhr_is_type(&annotation.type_annotation, ctx))
    })
}

fn sync_xhr_pattern_contains_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            sync_xhr_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .any(|property| sync_xhr_pattern_contains_symbol(&property.value, symbol_id)),
        BindingPattern::ArrayPattern(pattern) => pattern
            .elements
            .iter()
            .flatten()
            .any(|element| sync_xhr_pattern_contains_symbol(element, symbol_id)),
    }
}

fn sync_xhr_is_type(type_node: &TSType<'_>, ctx: &LintContext<'_>) -> bool {
    match type_node {
        TSType::TSTypeReference(reference) => matches!(
            &reference.type_name,
            TSTypeName::IdentifierReference(identifier)
                if identifier.name == "XMLHttpRequest"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        ),
        TSType::TSUnionType(union) => {
            let mut has_xhr = false;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                ) {
                    continue;
                }
                if !sync_xhr_is_type(member, ctx) {
                    return false;
                }
                has_xhr = true;
            }
            has_xhr
        }
        _ => false,
    }
}

fn sync_xhr_local_factory_returns_xhr<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
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
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_id = match declaration.kind() {
        AstKind::Function(function)
            if !function.r#async
                && !function.generator
                && !ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write) =>
        {
            declaration.id()
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) =>
        {
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            let Some(function_node) = ctx.nodes().iter().find(|candidate| {
                candidate.span() == initializer.get_inner_expression().span()
                    && matches!(
                        candidate.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
            }) else {
                return false;
            };
            if matches!(function_node.kind(), AstKind::Function(function) if function.r#async || function.generator)
                || matches!(function_node.kind(), AstKind::ArrowFunctionExpression(function) if function.r#async)
            {
                return false;
            }
            function_node.id()
        }
        _ => return false,
    };
    let mut has_return = false;
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(returned_expression) = &return_statement.argument else {
            return false;
        };
        if !sync_xhr_is_proven_receiver(returned_expression, ctx, &mut visited_symbol_ids.clone()) {
            return false;
        }
        has_return = true;
    }
    if has_return {
        return true;
    }
    let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
    else {
        return false;
    };
    function
        .get_expression()
        .is_some_and(|returned_expression| {
            sync_xhr_is_proven_receiver(returned_expression, ctx, &mut visited_symbol_ids.clone())
        })
}

fn sync_xhr_is_nullish(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    ) || matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn sync_xhr_has_prototype_open_replacement_before<'a>(
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let mutation_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(open_member) = assignment.left.as_member_expression() else {
                    return false;
                };
                let Some(prototype_member) = open_member.object().as_member_expression() else {
                    return false;
                };
                open_member.static_property_name() == Some("open")
                    && sync_xhr_is_global_xhr_prototype(prototype_member, ctx)
            }
            AstKind::CallExpression(call_expression) => {
                sync_xhr_is_prototype_define_property_call(call_expression, ctx)
            }
            _ => false,
        })
        .collect::<Vec<_>>();
    sync_xhr_mutations_dominate_call(&mutation_nodes, call_node, analysis, ctx)
}

fn sync_xhr_is_global_xhr_prototype<'a>(
    member: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    member.static_property_name() == Some("prototype")
        && is_proven_global_namespace_reference(member.object(), "XMLHttpRequest", ctx)
}

fn sync_xhr_is_prototype_define_property_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(MemberExpression::StaticMemberExpression(callee)) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if callee.property.name != "defineProperty"
        || !matches!(
            callee.object.get_inner_expression(),
            Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "Object" | "Reflect")
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none()
        )
    {
        return false;
    }
    let Some(prototype_member) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
        .and_then(Expression::as_member_expression)
    else {
        return false;
    };
    let is_open_property = matches!(
        call_expression
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression),
        Some(Expression::StringLiteral(literal)) if literal.value == "open"
    );
    is_open_property && sync_xhr_is_global_xhr_prototype(prototype_member, ctx)
}
