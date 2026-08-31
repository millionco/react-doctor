use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, AssignmentTarget, BindingPattern, Expression, Statement,
        TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This mutates the same object React already holds and hands it back, so Object.is sees no change and skips the re-render. Copy it first and update the copy.";
const MUTATING_METHOD_NAMES: [&str; 13] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
    "add",
    "clear",
    "delete",
    "set",
];
const FRESH_ARRAY_METHOD_NAMES: [&str; 10] = [
    "concat",
    "filter",
    "flat",
    "flatMap",
    "map",
    "slice",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum StateCollectionKind {
    Array,
    Map,
    Set,
}

#[derive(Clone, Copy)]
struct UseStatePair {
    declarator_id: NodeId,
    state_symbol_id: Option<SymbolId>,
}

#[derive(Clone, Copy)]
struct MutationFact {
    node_id: NodeId,
    reference_symbol_id: SymbolId,
}

#[derive(Debug, Default, Clone)]
pub struct NoMutateThenSetOrReturnSameReference;

declare_oxc_lint!(
    /// Disallow mutating React state and returning or setting the same reference.
    NoMutateThenSetOrReturnSameReference,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow returning a mutated React state reference.",
);

impl Rule for NoMutateThenSetOrReturnSameReference {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut mutation_facts_by_function_and_symbol =
            FxHashMap::<(NodeId, SymbolId), Vec<MutationFact>>::default();
        let mut fresh_reassignment_by_mutation = FxHashMap::<NodeId, bool>::default();
        let mut updater_results =
            FxHashMap::<(NodeId, Option<StateCollectionKind>), bool>::default();

        for call_node in ctx.nodes().iter() {
            let AstKind::CallExpression(setter_call) = call_node.kind() else {
                continue;
            };
            let Expression::Identifier(setter_identifier) =
                setter_call.callee.get_inner_expression()
            else {
                continue;
            };
            let Some(pair) = same_reference_resolve_use_state_pair(setter_identifier, ctx) else {
                continue;
            };
            let Some(argument) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let collection_kind = same_reference_state_collection_kind(pair.declarator_id, ctx);
            let mut has_violation = false;

            if let Some(state_symbol_id) = pair.state_symbol_id {
                if same_reference_is_self_returning_mutation_call(
                    argument,
                    state_symbol_id,
                    collection_kind,
                    ctx,
                ) {
                    has_violation = true;
                } else {
                    let same_reference_results = same_reference_result_expressions(
                        argument,
                        state_symbol_id,
                        collection_kind,
                        ctx,
                    );
                    if same_reference_results.is_empty() {
                        if let Some(updater_function_id) =
                            same_reference_resolve_local_function(argument, ctx)
                        {
                            has_violation = *updater_results
                                .entry((updater_function_id, collection_kind))
                                .or_insert_with(|| {
                                    same_reference_updater_has_violation(
                                        updater_function_id,
                                        collection_kind,
                                        ctx,
                                    )
                                });
                        }
                    } else if let Some(function_id) =
                        same_reference_nearest_function_id(call_node.id(), ctx)
                    {
                        let mutation_facts = mutation_facts_by_function_and_symbol
                            .entry((function_id, state_symbol_id))
                            .or_insert_with(|| {
                                same_reference_collect_mutation_facts(
                                    function_id,
                                    state_symbol_id,
                                    collection_kind,
                                    ctx,
                                )
                            });
                        has_violation = mutation_facts.iter().any(|mutation_fact| {
                            let mutation_node = ctx.nodes().get_node(mutation_fact.node_id);
                            if !same_reference_results.iter().any(|result| {
                                let result_node = ctx.nodes().get_node(result.node_id());
                                same_reference_node_precedes(
                                    mutation_node,
                                    result_node,
                                    function_id,
                                    ctx,
                                )
                            }) {
                                return false;
                            }
                            !*fresh_reassignment_by_mutation
                                .entry(mutation_fact.node_id)
                                .or_insert_with(|| {
                                    same_reference_has_fresh_reassignment_before(
                                        function_id,
                                        state_symbol_id,
                                        mutation_fact.node_id,
                                        collection_kind,
                                        mutation_fact.reference_symbol_id,
                                        ctx,
                                    )
                                })
                        });
                    }
                }
            } else if let Some(updater_function_id) =
                same_reference_resolve_local_function(argument, ctx)
            {
                has_violation = *updater_results
                    .entry((updater_function_id, collection_kind))
                    .or_insert_with(|| {
                        same_reference_updater_has_violation(
                            updater_function_id,
                            collection_kind,
                            ctx,
                        )
                    });
            }

            if has_violation {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(setter_call.span));
            }
        }
    }
}

fn same_reference_resolve_use_state_pair<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<UseStatePair> {
    let setter_symbol_id = resolve_const_identifier_root_symbol(setter_identifier, ctx)?;
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    let Expression::CallExpression(use_state_call) = declarator.init.as_ref()? else {
        return None;
    };
    if setter_binding.symbol_id() != setter_symbol_id
        || !same_reference_is_use_state_call(use_state_call, ctx)
    {
        return None;
    }
    let state_symbol_id = pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(|element| match element {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
            _ => None,
        });
    Some(UseStatePair {
        declarator_id: declaration.id(),
        state_symbol_id,
    })
}

fn same_reference_is_use_state_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_api_call(call, "useState", ctx) {
        return true;
    }
    matches!(
        call.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "useState"
                && same_reference_is_unresolved_identifier(identifier, ctx)
    )
}

fn same_reference_state_collection_kind(
    declarator_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<StateCollectionKind> {
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().get_node(declarator_id).kind() else {
        return None;
    };
    let Expression::CallExpression(use_state_call) = declarator.init.as_ref()? else {
        return None;
    };
    if let Some(state_type) = use_state_call
        .type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
    {
        match state_type {
            TSType::TSArrayType(_) | TSType::TSTupleType(_) => {
                return Some(StateCollectionKind::Array);
            }
            TSType::TSTypeReference(reference) => {
                if let TSTypeName::IdentifierReference(identifier) = &reference.type_name {
                    match identifier.name.as_str() {
                        "Array" | "ReadonlyArray" => return Some(StateCollectionKind::Array),
                        "Map" => return Some(StateCollectionKind::Map),
                        "Set" => return Some(StateCollectionKind::Set),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    let mut initializer = use_state_call
        .arguments
        .first()
        .and_then(Argument::as_expression)?
        .get_inner_expression();
    if let Expression::ArrowFunctionExpression(function) = initializer
        && let Some(expression) = function.get_expression()
    {
        initializer = expression.get_inner_expression();
    }
    if matches!(initializer, Expression::ArrayExpression(_)) {
        return Some(StateCollectionKind::Array);
    }
    let Expression::NewExpression(construction) = initializer else {
        return None;
    };
    let Expression::Identifier(constructor) = &construction.callee else {
        return None;
    };
    if !same_reference_is_unresolved_identifier(constructor, ctx) {
        return None;
    }
    match constructor.name.as_str() {
        "Array" => Some(StateCollectionKind::Array),
        "Map" | "WeakMap" => Some(StateCollectionKind::Map),
        "Set" | "WeakSet" => Some(StateCollectionKind::Set),
        _ => None,
    }
}

fn same_reference_resolve_local_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_) => Some(declaration.id()),
                AstKind::VariableDeclarator(declarator) => {
                    match declarator.init.as_ref()?.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        Expression::FunctionExpression(function) => Some(function.node_id.get()),
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn same_reference_expression_root_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut expression = expression.get_inner_expression();
    while let Some(member) = expression.as_member_expression() {
        expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    resolve_const_identifier_root_symbol(identifier, ctx)
}

fn same_reference_expression_base_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut expression = expression.get_inner_expression();
    while let Some(member) = expression.as_member_expression() {
        expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn same_reference_exact_object_assign_target<'a, 'borrow>(
    call: &'borrow oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'borrow Expression<'a>> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if member.static_property_name().as_deref() != Some("assign") {
        return None;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    if receiver.name != "Object" || !same_reference_is_unresolved_identifier(receiver, ctx) {
        return None;
    }
    call.arguments.first().and_then(Argument::as_expression)
}

fn same_reference_is_self_returning_mutation_call<'a>(
    expression: &Expression<'a>,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    if let Some(target) = same_reference_exact_object_assign_target(call, ctx) {
        return same_reference_expression_root_symbol(target, ctx) == Some(expected_symbol_id);
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let required_kind = match method_name.as_ref() {
        "add" => StateCollectionKind::Set,
        "set" => StateCollectionKind::Map,
        "sort" | "reverse" | "fill" | "copyWithin" => StateCollectionKind::Array,
        _ => return false,
    };
    collection_kind == Some(required_kind)
        && same_reference_expression_root_symbol(member.object(), ctx) == Some(expected_symbol_id)
}

fn same_reference_result_expressions<'a, 'borrow>(
    expression: &'borrow Expression<'a>,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'a>,
) -> Vec<&'borrow Expression<'a>> {
    let expression = expression.get_inner_expression();
    if (matches!(expression, Expression::Identifier(identifier)
        if resolve_const_identifier_root_symbol(identifier, ctx) == Some(expected_symbol_id))
        || same_reference_is_self_returning_mutation_call(
            expression,
            expected_symbol_id,
            collection_kind,
            ctx,
        ))
    {
        return vec![expression];
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            let mut results = same_reference_result_expressions(
                &conditional.consequent,
                expected_symbol_id,
                collection_kind,
                ctx,
            );
            results.extend(same_reference_result_expressions(
                &conditional.alternate,
                expected_symbol_id,
                collection_kind,
                ctx,
            ));
            results
        }
        Expression::LogicalExpression(logical) => {
            let mut results = same_reference_result_expressions(
                &logical.left,
                expected_symbol_id,
                collection_kind,
                ctx,
            );
            results.extend(same_reference_result_expressions(
                &logical.right,
                expected_symbol_id,
                collection_kind,
                ctx,
            ));
            results
        }
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().map_or_else(Vec::new, |last| {
                same_reference_result_expressions(last, expected_symbol_id, collection_kind, ctx)
            })
        }
        _ => Vec::new(),
    }
}

fn same_reference_collect_mutation_facts(
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'_>,
) -> Vec<MutationFact> {
    let function_span = ctx.nodes().get_node(function_id).span();
    let mut facts = Vec::new();
    for candidate in ctx.nodes().iter() {
        if !function_span.contains_inclusive(candidate.span())
            || !same_reference_node_belongs_to_function(candidate, function_id, ctx)
        {
            continue;
        }
        let receiver = match candidate.kind() {
            AstKind::CallExpression(call) => {
                if let Some(target) = same_reference_exact_object_assign_target(call, ctx)
                    && same_reference_expression_root_symbol(target, ctx)
                        == Some(expected_symbol_id)
                {
                    target
                } else {
                    let Some(member) = call.callee.get_inner_expression().as_member_expression()
                    else {
                        continue;
                    };
                    let Some(method_name) = member.static_property_name() else {
                        continue;
                    };
                    if !MUTATING_METHOD_NAMES.contains(&method_name.as_ref())
                        || same_reference_expression_root_symbol(member.object(), ctx)
                            != Some(expected_symbol_id)
                        || (collection_kind.is_none()
                            && (member
                                .object()
                                .get_inner_expression()
                                .as_member_expression()
                                .is_none()
                                || !is_result_discarded_call(candidate, true, ctx)))
                    {
                        continue;
                    }
                    member.object()
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                let Some(member) = assignment.left.as_member_expression() else {
                    continue;
                };
                if same_reference_expression_root_symbol(member.object(), ctx)
                    != Some(expected_symbol_id)
                {
                    continue;
                }
                member.object()
            }
            AstKind::UpdateExpression(update) => {
                let Some(member) = update.argument.as_member_expression() else {
                    continue;
                };
                if same_reference_expression_root_symbol(member.object(), ctx)
                    != Some(expected_symbol_id)
                {
                    continue;
                }
                member.object()
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                let Some(member) = unary.argument.get_inner_expression().as_member_expression()
                else {
                    continue;
                };
                if same_reference_expression_root_symbol(member.object(), ctx)
                    != Some(expected_symbol_id)
                {
                    continue;
                }
                member.object()
            }
            _ => continue,
        };
        if let Some(reference_symbol_id) = same_reference_expression_base_symbol(receiver, ctx) {
            facts.push(MutationFact {
                node_id: candidate.id(),
                reference_symbol_id,
            });
        }
    }
    facts
}

fn same_reference_updater_has_violation(
    function_id: NodeId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let BindingPattern::BindingIdentifier(parameter) = &first_parameter.pattern else {
        return false;
    };
    let parameter_symbol_id = parameter.symbol_id();
    let mut mutation_facts = same_reference_collect_mutation_facts(
        function_id,
        parameter_symbol_id,
        collection_kind,
        ctx,
    );
    if mutation_facts.is_empty() {
        return false;
    }
    if !same_reference_function_reassigns_symbol(function_id, parameter_symbol_id, ctx) {
        let mut earliest_by_block = FxHashMap::default();
        let mut without_block = Vec::new();
        for fact in mutation_facts {
            let block_id = ctx.nodes().cfg_id(fact.node_id);
            let entry = earliest_by_block.entry(block_id).or_insert(fact);
            if ctx.nodes().get_node(fact.node_id).span().start
                < ctx.nodes().get_node(entry.node_id).span().start
            {
                *entry = fact;
            }
        }
        without_block.extend(earliest_by_block.into_values());
        mutation_facts = without_block;
    }
    let mut result_expressions = Vec::new();
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        result_expressions.push(expression);
    }
    for candidate in ctx.nodes().iter() {
        if same_reference_node_belongs_to_function(candidate, function_id, ctx)
            && let AstKind::ReturnStatement(statement) = candidate.kind()
            && let Some(argument) = &statement.argument
        {
            result_expressions.push(argument);
        }
    }
    for result_expression in result_expressions {
        let result_node = ctx.nodes().get_node(result_expression.node_id());
        let same_reference_results = same_reference_result_expressions(
            result_expression,
            parameter_symbol_id,
            collection_kind,
            ctx,
        );
        for same_result in same_reference_results {
            let same_result_node = ctx.nodes().get_node(same_result.node_id());
            let Some(result_reference_symbol_id) =
                same_reference_result_symbol_id(same_result, ctx)
            else {
                continue;
            };
            for mutation_fact in &mutation_facts {
                let mutation_node = ctx.nodes().get_node(mutation_fact.node_id);
                if (result_node.span().contains_inclusive(mutation_node.span())
                    || same_reference_node_precedes(mutation_node, result_node, function_id, ctx))
                    && (mutation_fact.node_id == same_result.node_id()
                        || same_reference_node_precedes(
                            mutation_node,
                            same_result_node,
                            function_id,
                            ctx,
                        ))
                    && !same_reference_has_fresh_reassignment_before(
                        function_id,
                        parameter_symbol_id,
                        mutation_fact.node_id,
                        collection_kind,
                        mutation_fact.reference_symbol_id,
                        ctx,
                    )
                    && !same_reference_has_fresh_reassignment_between(
                        function_id,
                        parameter_symbol_id,
                        mutation_fact.node_id,
                        same_result.node_id(),
                        collection_kind,
                        result_reference_symbol_id,
                        ctx,
                    )
                {
                    return true;
                }
            }
        }
    }
    false
}

fn same_reference_result_symbol_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        Expression::CallExpression(call) => {
            if let Some(target) = same_reference_exact_object_assign_target(call, ctx) {
                return same_reference_expression_base_symbol(target, ctx);
            }
            call.callee
                .get_inner_expression()
                .as_member_expression()
                .and_then(|member| same_reference_expression_base_symbol(member.object(), ctx))
        }
        _ => None,
    }
}

fn same_reference_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn same_reference_node_belongs_to_function(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if node.id() == function_id {
        return true;
    }
    same_reference_nearest_function_id(node.id(), ctx) == Some(function_id)
}

fn same_reference_node_precedes(
    source: &AstNode<'_>,
    target: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    source.id() != target.id()
        && nodes_can_co_execute(source, target, ctx)
        && can_node_reach_later_node_within_function(
            source,
            target,
            ctx.nodes().get_node(function_id),
            ctx,
        )
}

fn same_reference_is_unresolved_identifier(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn same_reference_function_reassigns_symbol(
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|candidate| {
        if !function_span.contains_inclusive(candidate.span())
            || !same_reference_node_belongs_to_function(candidate, function_id, ctx)
        {
            return false;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
            return false;
        };
        resolve_const_identifier_root_symbol(identifier, ctx) == Some(expected_symbol_id)
    })
}

fn same_reference_assignment_targets_symbol<'a>(
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    expected_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    if assignment.operator != AssignmentOperator::Assign {
        return false;
    }
    let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
        return false;
    };
    resolve_const_identifier_root_symbol(identifier, ctx) == Some(expected_symbol_id)
}

fn same_reference_expression_is_definitely_fresh<'a>(
    expression: &Expression<'a>,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => true,
        Expression::NewExpression(construction) => {
            let Expression::Identifier(constructor) = construction.callee.get_inner_expression()
            else {
                return false;
            };
            matches!(
                constructor.name.as_str(),
                "Array" | "Map" | "Set" | "WeakMap" | "WeakSet"
            ) && same_reference_is_unresolved_identifier(constructor, ctx)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return false;
            }
            declarator.init.as_ref().is_some_and(|initializer| {
                same_reference_expression_is_definitely_fresh(
                    initializer,
                    expected_symbol_id,
                    collection_kind,
                    ctx,
                    visited_symbol_ids,
                )
            })
        }
        Expression::ConditionalExpression(conditional) => {
            same_reference_expression_is_definitely_fresh(
                &conditional.consequent,
                expected_symbol_id,
                collection_kind,
                ctx,
                &mut visited_symbol_ids.clone(),
            ) && same_reference_expression_is_definitely_fresh(
                &conditional.alternate,
                expected_symbol_id,
                collection_kind,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::CallExpression(call) => {
            if let Expression::Identifier(callee) = call.callee.get_inner_expression() {
                return matches!(callee.name.as_str(), "structuredClone" | "Array")
                    && same_reference_is_unresolved_identifier(callee, ctx);
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if collection_kind == Some(StateCollectionKind::Array)
                && FRESH_ARRAY_METHOD_NAMES.contains(&method_name.as_ref())
                && same_reference_expression_root_symbol(member.object(), ctx)
                    == Some(expected_symbol_id)
            {
                return true;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            method_name == "from"
                && receiver.name == "Array"
                && same_reference_is_unresolved_identifier(receiver, ctx)
        }
        _ => false,
    }
}

fn same_reference_has_fresh_reassignment_before(
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    target_id: NodeId,
    collection_kind: Option<StateCollectionKind>,
    reference_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    same_reference_last_unconditional_reassignment(
        function_id,
        expected_symbol_id,
        target_id,
        None,
        collection_kind,
        ctx,
    )
    .is_some_and(|assignment_id| {
        same_reference_reassignment_changes_reference(
            assignment_id,
            expected_symbol_id,
            reference_symbol_id,
            ctx,
        ) && same_reference_assignment_is_fresh(
            assignment_id,
            expected_symbol_id,
            collection_kind,
            ctx,
        )
    })
}

fn same_reference_has_fresh_reassignment_between(
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    source_id: NodeId,
    target_id: NodeId,
    collection_kind: Option<StateCollectionKind>,
    reference_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    same_reference_last_unconditional_reassignment(
        function_id,
        expected_symbol_id,
        target_id,
        Some(source_id),
        collection_kind,
        ctx,
    )
    .is_some_and(|assignment_id| {
        same_reference_reassignment_changes_reference(
            assignment_id,
            expected_symbol_id,
            reference_symbol_id,
            ctx,
        ) && same_reference_assignment_is_fresh(
            assignment_id,
            expected_symbol_id,
            collection_kind,
            ctx,
        )
    })
}

fn same_reference_last_unconditional_reassignment(
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    target_id: NodeId,
    lower_bound_id: Option<NodeId>,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let function_node = ctx.nodes().get_node(function_id);
    let target_node = ctx.nodes().get_node(target_id);
    let mut last_reassignment = None;
    for candidate in ctx.nodes().iter() {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if !function_node.span().contains_inclusive(candidate.span())
            || !same_reference_node_belongs_to_function(candidate, function_id, ctx)
            || !same_reference_assignment_targets_symbol(assignment, expected_symbol_id, ctx)
            || same_reference_assignment_is_conditional(candidate, function_id, ctx)
            || !same_reference_try_regions_preserve_reassignment(
                candidate,
                target_node,
                function_id,
                expected_symbol_id,
                collection_kind,
                ctx,
            )
            || lower_bound_id.is_some_and(|lower_bound_id| {
                !same_reference_node_precedes(
                    ctx.nodes().get_node(lower_bound_id),
                    candidate,
                    function_id,
                    ctx,
                )
            })
            || !same_reference_node_precedes(candidate, target_node, function_id, ctx)
        {
            continue;
        }
        if last_reassignment.is_none_or(|previous_id| {
            candidate.span().start > ctx.nodes().get_node(previous_id).span().start
        }) {
            last_reassignment = Some(candidate.id());
        }
    }
    last_reassignment
}

fn same_reference_assignment_is_conditional(
    assignment_node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(assignment_node.id())
        .take_while(|ancestor| ancestor.id() != function_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::IfStatement(_)
                    | AstKind::ConditionalExpression(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchCase(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
            )
        })
}

fn same_reference_reassignment_changes_reference(
    assignment_id: NodeId,
    expected_symbol_id: SymbolId,
    reference_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    reference_symbol_id == expected_symbol_id
        || ctx.symbol_declaration(reference_symbol_id).span().start
            > ctx.nodes().get_node(assignment_id).span().start
}

fn same_reference_assignment_is_fresh(
    assignment_id: NodeId,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::AssignmentExpression(assignment) = ctx.nodes().get_node(assignment_id).kind()
    else {
        return false;
    };
    same_reference_expression_is_definitely_fresh(
        &assignment.right,
        expected_symbol_id,
        collection_kind,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn same_reference_try_regions_preserve_reassignment(
    reassignment_node: &AstNode<'_>,
    target_node: &AstNode<'_>,
    function_id: NodeId,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(reassignment_node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        let AstKind::TryStatement(statement) = ancestor.kind() else {
            continue;
        };
        let shared_region = std::iter::once(statement.block.span())
            .chain(statement.handler.iter().map(|handler| handler.span()))
            .chain(statement.finalizer.iter().map(|finalizer| finalizer.span()))
            .any(|region| {
                region.contains_inclusive(reassignment_node.span())
                    && region.contains_inclusive(target_node.span())
            });
        if shared_region {
            continue;
        }
        if !statement
            .block
            .span()
            .contains_inclusive(reassignment_node.span())
            || ancestor.span().contains_inclusive(target_node.span())
            || statement.finalizer.is_some()
        {
            return false;
        }
        let is_only_try_statement = statement.block.body.len() == 1
            && matches!(&statement.block.body[0], Statement::ExpressionStatement(expression)
                if expression.expression.get_inner_expression().span() == reassignment_node.span());
        if let Some(handler) = &statement.handler
            && !same_reference_catch_preserves_fresh_reference(
                handler,
                expected_symbol_id,
                collection_kind,
                ctx,
            )
            && !(is_only_try_statement
                && same_reference_assignment_is_non_throwing_fresh(reassignment_node))
        {
            return false;
        }
    }
    true
}

fn same_reference_catch_preserves_fresh_reference<'a>(
    handler: &oxc_ast::ast::CatchClause<'a>,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut continuing = FxHashSet::from_iter([false]);
    for statement in &handler.body.body {
        continuing = same_reference_continuing_catch_freshness(
            statement,
            continuing,
            expected_symbol_id,
            collection_kind,
            ctx,
        );
        if continuing.is_empty() {
            break;
        }
    }
    continuing.into_iter().all(|is_fresh| is_fresh)
}

fn same_reference_continuing_catch_freshness<'a>(
    statement: &Statement<'a>,
    incoming: FxHashSet<bool>,
    expected_symbol_id: SymbolId,
    collection_kind: Option<StateCollectionKind>,
    ctx: &LintContext<'a>,
) -> FxHashSet<bool> {
    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => FxHashSet::default(),
        Statement::BlockStatement(block) => {
            let mut continuing = incoming;
            for child in &block.body {
                continuing = same_reference_continuing_catch_freshness(
                    child,
                    continuing,
                    expected_symbol_id,
                    collection_kind,
                    ctx,
                );
                if continuing.is_empty() {
                    break;
                }
            }
            continuing
        }
        Statement::IfStatement(branch) => {
            let mut continuing = same_reference_continuing_catch_freshness(
                &branch.consequent,
                incoming.clone(),
                expected_symbol_id,
                collection_kind,
                ctx,
            );
            if let Some(alternate) = &branch.alternate {
                continuing.extend(same_reference_continuing_catch_freshness(
                    alternate,
                    incoming,
                    expected_symbol_id,
                    collection_kind,
                    ctx,
                ));
            } else {
                continuing.extend(incoming);
            }
            continuing
        }
        Statement::ExpressionStatement(expression_statement) => {
            if let Expression::AssignmentExpression(assignment) =
                expression_statement.expression.get_inner_expression()
                && same_reference_assignment_targets_symbol(assignment, expected_symbol_id, ctx)
            {
                return FxHashSet::from_iter([same_reference_expression_is_definitely_fresh(
                    &assignment.right,
                    expected_symbol_id,
                    collection_kind,
                    ctx,
                    &mut FxHashSet::default(),
                )]);
            }
            if same_reference_statement_may_assign_symbol(statement, expected_symbol_id, ctx) {
                FxHashSet::from_iter([false])
            } else {
                incoming
            }
        }
        _ => {
            if same_reference_statement_may_assign_symbol(statement, expected_symbol_id, ctx) {
                FxHashSet::from_iter([false])
            } else {
                incoming
            }
        }
    }
}

fn same_reference_statement_may_assign_symbol(
    statement: &Statement<'_>,
    expected_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let statement_span = statement.span();
    let function_id = ctx.nodes().iter().find_map(|node| {
        (node.span() == statement_span)
            .then(|| same_reference_nearest_function_id(node.id(), ctx))
            .flatten()
    });
    ctx.nodes().iter().any(|candidate| {
        if !statement_span.contains_inclusive(candidate.span())
            || function_id.is_some_and(|function_id| {
                !same_reference_node_belongs_to_function(candidate, function_id, ctx)
            })
        {
            return false;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        same_reference_assignment_targets_symbol(assignment, expected_symbol_id, ctx)
    })
}

fn same_reference_assignment_is_non_throwing_fresh(reassignment_node: &AstNode<'_>) -> bool {
    let AstKind::AssignmentExpression(assignment) = reassignment_node.kind() else {
        return false;
    };
    match assignment.right.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            ArrayExpressionElement::Elision(_) => true,
            ArrayExpressionElement::SpreadElement(_) => false,
            element => element.as_expression().is_some_and(|expression| {
                matches!(
                    expression.get_inner_expression(),
                    Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BigIntLiteral(_)
                        | Expression::RegExpLiteral(_)
                        | Expression::StringLiteral(_)
                )
            }),
        }),
        Expression::ObjectExpression(object) => object.properties.is_empty(),
        _ => false,
    }
}
