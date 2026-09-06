use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const PROMISE_CHAIN_METHOD_NAMES: [&str; 3] = ["then", "catch", "finally"];
const TANSTACK_QUERY_HOOK_NAMES: [&str; 4] = [
    "useQuery",
    "useInfiniteQuery",
    "useSuspenseQuery",
    "useSuspenseInfiniteQuery",
];
const TANSTACK_QUERY_MODULE_SOURCES: [&str; 2] = ["@tanstack/react-query", "react-query"];
const MESSAGE: &str =
    "refetch() inside useEffect duplicates work React Query already does, causing extra fetches.";

#[derive(Debug, Default, Clone)]
pub struct QueryNoQueryInEffect;

declare_oxc_lint!(
    /// Disallow refetching TanStack Query results from effects.
    QueryNoQueryInEffect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow refetching TanStack Query results from effects.",
);

impl Rule for QueryNoQueryInEffect {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !effect_hook_call_matches(effect_call) {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = effect_callback_node_id(callback_expression, ctx) else {
                continue;
            };
            for_each_query_effect_call(callback_id, ctx, |call_node, call_expression| {
                if is_tanstack_refetch_call(
                    call_node,
                    call_expression,
                    &property_write_analysis,
                    ctx,
                ) {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
                }
            });
        }
    }
}

fn effect_hook_call_matches(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    match callee {
        Expression::Identifier(identifier) => EFFECT_HOOK_NAMES.contains(&identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
            .is_some_and(|name| EFFECT_HOOK_NAMES.contains(&name)),
    }
}

fn effect_callback_node_id<'a>(
    callback_expression: &Expression<'a>,
    _ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    match callback_expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn for_each_query_effect_call<'a>(
    callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&AstNode<'a>, &oxc_ast::ast::CallExpression<'a>),
) {
    let callback_span = ctx.nodes().get_node(callback_id).span();
    let mut pending_function_ids = vec![callback_id];
    let mut visited_function_ids = FxHashSet::default();
    while let Some(function_id) = pending_function_ids.pop() {
        if !visited_function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            visitor(candidate, call_expression);
            if let Some(called_function_id) =
                exact_local_callback_function_id(&call_expression.callee, ctx, &mut Vec::new())
                && callback_span.contains_inclusive(ctx.nodes().get_node(called_function_id).span())
            {
                pending_function_ids.push(called_function_id);
            }
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if !member_expression
                .static_property_name()
                .is_some_and(|name| PROMISE_CHAIN_METHOD_NAMES.contains(&name))
                || !matches!(
                    member_expression.object().get_inner_expression(),
                    Expression::CallExpression(_)
                )
            {
                continue;
            }
            for argument in &call_expression.arguments {
                let Some(callback) = argument.as_expression() else {
                    continue;
                };
                if let Some(callback_function_id) =
                    exact_local_callback_function_id(callback, ctx, &mut Vec::new())
                    && callback_span
                        .contains_inclusive(ctx.nodes().get_node(callback_function_id).span())
                {
                    pending_function_ids.push(callback_function_id);
                }
            }
        }
    }
}

fn is_tanstack_refetch_call<'a>(
    call_node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    is_tanstack_refetch_expression(
        &call_expression.callee,
        call_node,
        property_write_analysis,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn is_tanstack_refetch_expression<'a>(
    expression: &Expression<'a>,
    reference_node: &AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        if member_expression.static_property_name() != Some("refetch") {
            return false;
        }
        let receiver = member_expression.object().get_inner_expression();
        if !is_tanstack_query_result(receiver, ctx, &mut FxHashSet::default()) {
            return false;
        }
        return !matches!(receiver, Expression::Identifier(identifier) if query_has_refetch_write_before(
            identifier,
            reference_node,
            property_write_analysis,
            ctx,
        ));
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("refetch") {
        let Some(initializer) = &declarator.init else {
            return false;
        };
        let initializer = initializer.get_inner_expression();
        if !is_tanstack_query_result(initializer, ctx, &mut FxHashSet::default()) {
            return false;
        }
        return !matches!(initializer, Expression::Identifier(receiver) if query_has_refetch_write_before(
            receiver,
            declaration,
            property_write_analysis,
            ctx,
        ));
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    is_tanstack_refetch_expression(
        initializer,
        reference_node,
        property_write_analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn is_tanstack_query_result<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call_expression) = expression {
        return TANSTACK_QUERY_HOOK_NAMES.iter().any(|hook_name| {
            module_api_path_matches(
                &call_expression.callee,
                &[*hook_name],
                &TANSTACK_QUERY_MODULE_SOURCES,
                false,
                ctx,
            )
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator
        .init
        .as_ref()
        .is_some_and(|initializer| is_tanstack_query_result(initializer, ctx, visited_symbol_ids))
}

fn query_has_refetch_write_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    reference_node: &AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    let alias_symbol_ids = potential_alias_symbol_ids(root_symbol_id, ctx);
    for symbol_id in &alias_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(*symbol_id) {
            let reference_root =
                transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                continue;
            };
            if member.static_property_name().as_deref() != Some("refetch") {
                continue;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            let is_write = match parent.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == member_root.span() =>
                {
                    !query_is_same_refetch_member(&assignment.right, root_symbol_id, ctx)
                }
                AstKind::UpdateExpression(update)
                    if update.argument.span() == member_root.span() =>
                {
                    true
                }
                AstKind::UnaryExpression(unary)
                    if unary.operator == oxc_syntax::operator::UnaryOperator::Delete
                        && unary.argument.span() == member_root.span() =>
                {
                    true
                }
                _ => false,
            };
            if is_write
                && can_node_execute_before(parent, reference_node, property_write_analysis, ctx)
            {
                return true;
            }
        }
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !can_node_execute_before(candidate, reference_node, property_write_analysis, ctx) {
            return false;
        }
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        let Expression::Identifier(object_identifier) = member.object().get_inner_expression()
        else {
            return false;
        };
        if object_identifier.name != "Object"
            || ctx
                .scoping()
                .get_reference(object_identifier.reference_id())
                .symbol_id()
                .is_some()
        {
            return false;
        }
        let Some(target) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return false;
        };
        if !query_expression_has_root_symbol(target, root_symbol_id, ctx) {
            return false;
        }
        match member.static_property_name() {
            Some("defineProperty") => {
                let is_refetch_property = call
                    .arguments
                    .get(1)
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|property| {
                        matches!(property.get_inner_expression(), Expression::StringLiteral(literal) if literal.value == "refetch")
                    });
                if !is_refetch_property {
                    return false;
                }
                let preserved_value = call
                    .arguments
                    .get(2)
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .and_then(|descriptor| match descriptor.get_inner_expression() {
                        Expression::ObjectExpression(object) => object.properties.iter().find_map(|property| {
                            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                                return None;
                            };
                            (property.key.static_name().as_deref() == Some("value"))
                                .then_some(&property.value)
                        }),
                        _ => None,
                    })
                    .is_some_and(|value| query_is_same_refetch_member(value, root_symbol_id, ctx));
                !preserved_value
            }
            Some("assign") => {
                let mut final_refetch_value = None;
                for source in call.arguments.iter().skip(1) {
                    let Some(Expression::ObjectExpression(object)) =
                        source.as_expression().map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    for property in &object.properties {
                        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                        else {
                            continue;
                        };
                        if property.key.static_name().as_deref() == Some("refetch") {
                            final_refetch_value = Some(&property.value);
                        }
                    }
                }
                final_refetch_value.is_some_and(|value| {
                    !query_is_same_refetch_member(value, root_symbol_id, ctx)
                })
            }
            _ => false,
        }
    })
}

fn query_expression_has_root_symbol<'a>(
    expression: &Expression<'a>,
    root_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    resolve_const_identifier_root_symbol(identifier, ctx) == Some(root_symbol_id)
}

fn query_is_same_refetch_member<'a>(
    expression: &Expression<'a>,
    root_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("refetch")
        && query_expression_has_root_symbol(member.object(), root_symbol_id, ctx)
}
