use std::path::{Path as DerivedStateEffectPath, PathBuf as DerivedStateEffectPathBuf};

use oxc_allocator::Allocator as DerivedStateEffectAllocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern,
        ExportDefaultDeclarationKind as DerivedStateEffectExportDefaultDeclarationKind, Expression,
        Statement as DerivedStateEffectStatement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser as DerivedStateEffectParser;
use oxc_resolver::{
    ResolveOptions as DerivedStateEffectResolveOptions, Resolver as DerivedStateEffectResolver,
    TsconfigDiscovery as DerivedStateEffectTsconfigDiscovery,
};
use oxc_semantic::{
    NodeId, Semantic as DerivedStateEffectSemantic,
    SemanticBuilder as DerivedStateEffectSemanticBuilder, SymbolId,
};
use oxc_span::{GetSpan, SourceType as DerivedStateEffectSourceType};
use rustc_hash::{
    FxHashMap as DerivedStateEffectFxHashMap, FxHashSet as DerivedStateEffectFxHashSet,
};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{
        ExportExportName as DerivedStateEffectExportExportName,
        ImportImportName as DerivedStateEffectImportImportName,
        ModuleRecord as DerivedStateEffectModuleRecord,
    },
    rule::Rule,
};

const EFFECT_HOOK_NAMES: [&str; 3] = ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const DERIVED_PURE_DIRECT_CALLS: [&str; 10] = [
    "Array",
    "BigInt",
    "Boolean",
    "Number",
    "Object",
    "String",
    "encodeURIComponent",
    "parseFloat",
    "parseInt",
    "structuredClone",
];
const DERIVED_PURE_MEMBER_CALLS: [&str; 14] = [
    "concat",
    "filter",
    "flatMap",
    "join",
    "map",
    "reduce",
    "replace",
    "slice",
    "split",
    "toLowerCase",
    "toSorted",
    "toString",
    "toUpperCase",
    "trim",
];
const DERIVED_SYNCHRONOUS_ITERATOR_METHODS: [&str; 10] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];
const DERIVED_STATE_EFFECT_FRESH_ARRAY_COPY_METHODS: [&str; 7] = [
    "concat", "filter", "flatMap", "map", "slice", "split", "toSorted",
];
const MESSAGE: &str = "You pay an extra render for state you can derive from other values.";
const DERIVED_MAX_IMPORTED_HELPER_DEPTH: usize = 4;

struct DerivedValueContext<'node, 'ast> {
    substitutions: DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    write_anchor: &'node AstNode<'ast>,
}

mod derived_state_effect_lint {
    use super::*;

    #[derive(Debug, Default, Clone)]
    pub struct NoDerivedStateEffect;

    declare_oxc_lint!(
        /// Warns when render-known derived state is stored in an effect.
        NoDerivedStateEffect,
        react_doctor_native,
        correctness,
        version = "0.1.0",
        short_description = "Warns when render-known derived state is stored in an effect.",
    );

    impl Rule for NoDerivedStateEffect {
        fn should_run(&self, ctx: &ContextHost) -> bool {
            !is_test_noise_file(ctx)
        }

        fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
            let AstKind::CallExpression(effect_call) = node.kind() else {
                return;
            };
            if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
                return;
            }
            let Some(component_id) = derived_nearest_function_id(node.id(), ctx) else {
                return;
            };
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                return;
            };
            let Some(execution_callback_expression) =
                derived_state_effect_unwrapped_callback_expression(
                    callback_expression,
                    ctx,
                    &mut Vec::new(),
                )
            else {
                return;
            };
            let Some(callback_id) = exact_local_callback_function_id(
                execution_callback_expression,
                ctx,
                &mut Vec::new(),
            ) else {
                return;
            };
            if derived_function_is_async_or_generator(callback_id, ctx) {
                return;
            }

            let mut execution_node_ids = Vec::new();
            for_each_local_callback_execution_node(
                execution_callback_expression,
                ctx,
                |candidate, _, _| {
                    if matches!(candidate.kind(), AstKind::CallExpression(_)) {
                        execution_node_ids.push(candidate.id());
                    }
                },
            );
            derived_state_effect_expand_synchronous_iterator_execution_nodes(
                &mut execution_node_ids,
                ctx,
            );
            let mut did_find_derived_write = false;
            let execution_node_id_set = execution_node_ids
                .iter()
                .copied()
                .collect::<DerivedStateEffectFxHashSet<_>>();
            let effect_has_cleanup = derived_state_effect_has_cleanup(callback_id, ctx);
            for candidate_id in execution_node_ids.iter().copied() {
                let candidate = ctx.nodes().get_node(candidate_id);
                if derived_enclosing_function_is_async_or_generator(candidate.id(), ctx) {
                    continue;
                }
                let AstKind::CallExpression(setter_call) = candidate.kind() else {
                    continue;
                };
                if setter_call.arguments.len() != 1 {
                    continue;
                }
                let Expression::Identifier(setter_identifier) =
                    setter_call.callee.get_inner_expression()
                else {
                    continue;
                };
                let Some((state_symbol_id, setter_symbol_id)) =
                    derived_resolve_use_state_pair(setter_identifier, ctx)
                else {
                    continue;
                };
                let has_independent_writer = derived_setter_has_independent_writer(
                    setter_symbol_id,
                    effect_call.span,
                    component_id,
                    ctx,
                );
                let is_cleanup_managed = effect_has_cleanup
                    && derived_state_effect_has_deferred_setter_writer(
                        setter_symbol_id,
                        effect_call.span,
                        component_id,
                        &execution_node_id_set,
                        ctx,
                    );
                let Some(written_value) = setter_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                else {
                    continue;
                };
                let value_contexts = derived_state_effect_setter_value_contexts(
                    candidate,
                    &execution_node_id_set,
                    ctx,
                );
                let is_render_known_copy = value_contexts.iter().any(|value_context| {
                    let mut source_state_symbols = DerivedStateEffectFxHashSet::default();
                    let is_render_known = derived_written_value_is_render_known(
                        written_value,
                        component_id,
                        state_symbol_id,
                        ctx,
                        &mut Vec::new(),
                        &mut source_state_symbols,
                        &value_context.substitutions,
                        1,
                    );
                    is_render_known
                        && !source_state_symbols.iter().any(|source_symbol_id| {
                            derived_effect_resets_source_state(
                                *source_symbol_id,
                                value_context.write_anchor,
                                &execution_node_ids,
                                ctx,
                            )
                        })
                });
                let is_selection_repair = value_contexts.iter().any(|value_context| {
                    let selection_written_value = match written_value.get_inner_expression() {
                        Expression::Identifier(identifier) => ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .and_then(|symbol_id| value_context.substitutions.get(&symbol_id))
                            .copied()
                            .unwrap_or(written_value),
                        _ => written_value,
                    };
                    derived_is_render_known_selection_repair(
                        selection_written_value,
                        state_symbol_id,
                        has_independent_writer,
                        candidate.id(),
                        callback_id,
                        effect_call,
                        component_id,
                        ctx,
                    ) || derived_is_render_known_selection_repair(
                        selection_written_value,
                        state_symbol_id,
                        has_independent_writer,
                        value_context.write_anchor.id(),
                        callback_id,
                        effect_call,
                        component_id,
                        ctx,
                    )
                });
                if !(is_render_known_copy && !has_independent_writer && !is_cleanup_managed
                    || is_selection_repair)
                {
                    continue;
                }
                did_find_derived_write = true;
                break;
            }
            if did_find_derived_write {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
            }
        }
    }
}

pub use derived_state_effect_lint::NoDerivedStateEffect;

fn derived_state_effect_unwrapped_callback_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<&'a Expression<'a>> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            Some(expression)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::Function(_) => Some(expression),
                AstKind::VariableDeclarator(declarator) if matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()) => {
                    derived_state_effect_unwrapped_callback_expression(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            };
            visited_symbol_ids.pop();
            result
        }
        Expression::CallExpression(wrapper_call)
            if is_react_hook_call(wrapper_call, &["useCallback", "useEffectEvent"], ctx)
                || derived_state_effect_local_use_event_preserves_callback(
                    &wrapper_call.callee,
                    ctx,
                ) =>
        {
            derived_state_effect_unwrapped_callback_expression(
                wrapper_call.arguments.first()?.as_expression()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn derived_state_effect_local_use_event_preserves_callback<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return false;
    };
    if !matches!(identifier.name.as_str(), "useEvent" | "useEventCallback") {
        return false;
    }
    let Some(implementation_id) = exact_local_callback_function_id(callee, ctx, &mut Vec::new())
    else {
        return false;
    };
    let implementation = ctx.nodes().get_node(implementation_id);
    let callback_symbol_id = match implementation.kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return false,
    }
    .first()
    .and_then(|parameter| match &parameter.pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier),
        _ => None,
    })
    .map(|binding| binding.symbol_id());
    let Some(callback_symbol_id) = callback_symbol_id else {
        return false;
    };
    let callback_ref_symbol_ids = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                return None;
            };
            if !implementation.span().contains_inclusive(candidate.span())
                || derived_nearest_function_id(candidate.id(), ctx) != Some(implementation_id)
            {
                return None;
            }
            let BindingPattern::BindingIdentifier(ref_binding) = &declarator.id else {
                return None;
            };
            let Expression::CallExpression(ref_call) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            if !is_react_hook_call(ref_call, &["useRef"], ctx) {
                return None;
            }
            let Expression::Identifier(initializer) = ref_call
                .arguments
                .first()
                .and_then(Argument::as_expression)?
                .get_inner_expression()
            else {
                return None;
            };
            (ctx.scoping()
                .get_reference(initializer.reference_id())
                .symbol_id()
                == Some(callback_symbol_id))
            .then(|| ref_binding.symbol_id())
        })
        .collect::<DerivedStateEffectFxHashSet<_>>();
    if callback_ref_symbol_ids.is_empty() {
        return false;
    }
    let mut did_find_forwarding_callback = false;
    derived_for_each_returned_expression(implementation_id, ctx, |returned_expression| {
        if did_find_forwarding_callback {
            return;
        }
        let Expression::CallExpression(wrapper_call) = returned_expression.get_inner_expression()
        else {
            return;
        };
        if !is_react_hook_call(wrapper_call, &["useCallback", "useEffectEvent"], ctx) {
            return;
        }
        let Some(stable_callback_id) = wrapper_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(derived_function_expression_node_id)
        else {
            return;
        };
        let stable_callback_span = ctx.nodes().get_node(stable_callback_id).span();
        did_find_forwarding_callback = ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            if !stable_callback_span.contains_inclusive(candidate.span())
                || derived_nearest_function_id(candidate.id(), ctx) != Some(stable_callback_id)
            {
                return false;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            let Expression::Identifier(ref_identifier) = member.object().get_inner_expression()
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(ref_identifier.reference_id())
                .symbol_id()
                .is_some_and(|ref_symbol_id| {
                    callback_ref_symbol_ids.contains(&ref_symbol_id)
                        && !derived_state_effect_ref_has_non_forwarding_assignment(
                            ref_symbol_id,
                            callback_symbol_id,
                            ctx,
                        )
                })
        });
    });
    did_find_forwarding_callback
}

fn derived_state_effect_ref_has_non_forwarding_assignment(
    ref_symbol_id: SymbolId,
    callback_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(ref_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(reference_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            let assignment_node = ctx.nodes().parent_node(member_node.id());
            let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                return false;
            };
            if assignment.left.span() != member_node.span() {
                return false;
            }
            let Expression::Identifier(right_identifier) = assignment.right.get_inner_expression()
            else {
                return true;
            };
            ctx.scoping()
                .get_reference(right_identifier.reference_id())
                .symbol_id()
                != Some(callback_symbol_id)
        })
}

fn derived_is_render_known_selection_repair(
    written_value: &Expression<'_>,
    written_state_symbol_id: SymbolId,
    has_independent_writer: bool,
    setter_call_id: NodeId,
    callback_id: NodeId,
    effect_call: &oxc_ast::ast::CallExpression<'_>,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if !has_independent_writer
        || !derived_write_is_controlled_by_state(
            written_value,
            written_state_symbol_id,
            setter_call_id,
            callback_id,
            component_id,
            ctx,
        )
    {
        return false;
    }
    let Some(indexed_root_symbol_id) = derived_written_index_root_symbol(written_value, ctx) else {
        return false;
    };
    if !derived_symbol_has_state_source(indexed_root_symbol_id, component_id, ctx, &mut Vec::new())
    {
        return false;
    }
    let Some(Expression::ArrayExpression(dependencies)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    dependencies
        .elements
        .iter()
        .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        .any(|dependency| {
            derived_expression_references_symbol(dependency, indexed_root_symbol_id, ctx)
        })
}

fn derived_written_index_root_symbol(
    written_value: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Some(function_node_id) = derived_function_expression_node_id(written_value) else {
        return derived_numeric_index_root_symbol(written_value, false, ctx);
    };
    let current_state_symbol_id = derived_first_parameter_symbol(function_node_id, ctx)?;
    let mut indexed_root_symbol_id = None;
    let mut returned_expression_count = 0;
    let mut all_returns_are_compatible = true;
    derived_for_each_returned_expression(function_node_id, ctx, |returned_expression| {
        returned_expression_count += 1;
        let Some(returned_root_symbol_id) = derived_compatible_index_root_symbol(
            returned_expression,
            current_state_symbol_id,
            ctx,
            &mut Vec::new(),
        ) else {
            all_returns_are_compatible = false;
            return;
        };
        if let Some(returned_root_symbol_id) = returned_root_symbol_id {
            if indexed_root_symbol_id.is_some_and(|root| root != returned_root_symbol_id) {
                all_returns_are_compatible = false;
                return;
            }
            indexed_root_symbol_id = Some(returned_root_symbol_id);
        }
    });
    (returned_expression_count > 0 && all_returns_are_compatible)
        .then_some(indexed_root_symbol_id)
        .flatten()
}

fn derived_compatible_index_root_symbol(
    expression: &Expression<'_>,
    current_state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<Option<SymbolId>> {
    if derived_expression_is_symbol(expression, current_state_symbol_id, ctx) {
        return Some(None);
    }
    if let Some(root_symbol_id) = derived_numeric_index_root_symbol(expression, false, ctx) {
        return Some(Some(root_symbol_id));
    }
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(expression) => derived_merge_index_roots(
            derived_compatible_index_root_symbol(
                &expression.consequent,
                current_state_symbol_id,
                ctx,
                visited_symbol_ids,
            )?,
            derived_compatible_index_root_symbol(
                &expression.alternate,
                current_state_symbol_id,
                ctx,
                visited_symbol_ids,
            )?,
        ),
        Expression::LogicalExpression(expression) => derived_merge_index_roots(
            derived_compatible_index_root_symbol(
                &expression.left,
                current_state_symbol_id,
                ctx,
                visited_symbol_ids,
            )?,
            derived_compatible_index_root_symbol(
                &expression.right,
                current_state_symbol_id,
                ctx,
                visited_symbol_ids,
            )?,
        ),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let result = derived_compatible_index_root_symbol(
                declarator.init.as_ref()?,
                current_state_symbol_id,
                ctx,
                visited_symbol_ids,
            );
            visited_symbol_ids.pop();
            result
        }
        _ => None,
    }
}

fn derived_merge_index_roots(
    first: Option<SymbolId>,
    second: Option<SymbolId>,
) -> Option<Option<SymbolId>> {
    match (first, second) {
        (Some(first), Some(second)) if first != second => None,
        (Some(root), _) | (_, Some(root)) => Some(Some(root)),
        (None, None) => Some(None),
    }
}

fn derived_numeric_index_root_symbol(
    expression: &Expression<'_>,
    has_numeric_index: bool,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) if has_numeric_index => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        Expression::StaticMemberExpression(member) => {
            derived_numeric_index_root_symbol(&member.object, has_numeric_index, ctx)
        }
        Expression::ComputedMemberExpression(member) => derived_numeric_index_root_symbol(
            &member.object,
            has_numeric_index || matches!(&member.expression, Expression::NumericLiteral(_)),
            ctx,
        ),
        _ => None,
    }
}

fn derived_write_is_controlled_by_state(
    written_value: &Expression<'_>,
    state_symbol_id: SymbolId,
    setter_call_id: NodeId,
    callback_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(function_node_id) = derived_function_expression_node_id(written_value)
        && let Some(parameter_symbol_id) = derived_first_parameter_symbol(function_node_id, ctx)
        && derived_function_reads_symbol(function_node_id, parameter_symbol_id, ctx)
    {
        return true;
    }

    let mut child_span = ctx.nodes().get_node(setter_call_id).span();
    for ancestor in ctx.nodes().ancestors(setter_call_id) {
        if ancestor.id() == callback_id {
            return false;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if (statement.consequent.span().contains_inclusive(child_span)
                    || statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(child_span)
                    }))
                    && derived_expression_synchronously_references_symbol(
                        &statement.test,
                        state_symbol_id,
                        component_id,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if (expression.consequent.span().contains_inclusive(child_span)
                    || expression.alternate.span().contains_inclusive(child_span))
                    && derived_expression_synchronously_references_symbol(
                        &expression.test,
                        state_symbol_id,
                        component_id,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(child_span)
                    && derived_expression_synchronously_references_symbol(
                        &expression.left,
                        state_symbol_id,
                        component_id,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::BlockStatement(block) => {
                let Some(statement_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(child_span))
                else {
                    child_span = ancestor.span();
                    continue;
                };
                for previous_statement in block.body.iter().take(statement_index) {
                    let oxc_ast::ast::Statement::IfStatement(previous_if) = previous_statement
                    else {
                        continue;
                    };
                    if statement_always_exits(&previous_if.consequent)
                        && derived_expression_synchronously_references_symbol(
                            &previous_if.test,
                            state_symbol_id,
                            component_id,
                            ctx,
                        )
                    {
                        return true;
                    }
                }
            }
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn derived_expression_synchronously_references_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| {
            expression
                .span()
                .contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
        })
        .any(|reference| {
            derived_reference_is_synchronously_executed(
                reference.node_id(),
                expression.span(),
                component_id,
                ctx,
            )
        })
}

fn derived_reference_is_synchronously_executed(
    reference_node_id: NodeId,
    expression_span: oxc_span::Span,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx
        .nodes()
        .ancestors(reference_node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
    {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if derived_function_is_async_or_generator(ancestor.id(), ctx) {
            return false;
        }
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            return false;
        };
        if call_expression
            .callee
            .span()
            .contains_inclusive(ancestor.span())
        {
            continue;
        }
        if !call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span() == ancestor.span())
        }) {
            return false;
        }
        let Some(member) = call_expression.callee.as_member_expression() else {
            return false;
        };
        if !member
            .static_property_name()
            .is_some_and(|method_name| DERIVED_SYNCHRONOUS_ITERATOR_METHODS.contains(&method_name))
        {
            return false;
        }
        let Some(receiver_symbol_id) = derived_expression_root_symbol(member.object(), ctx) else {
            return false;
        };
        if !derived_symbol_has_state_source(receiver_symbol_id, component_id, ctx, &mut Vec::new())
        {
            return false;
        }
    }
    true
}

fn derived_expression_root_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        expression => expression
            .as_member_expression()
            .and_then(|member| derived_expression_root_symbol(member.object(), ctx)),
    }
}

fn derived_first_parameter_symbol(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match ctx.nodes().get_node(function_node_id).kind() {
        AstKind::Function(function) => match &function.params.items.first()?.pattern {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
            _ => None,
        },
        AstKind::ArrowFunctionExpression(function) => {
            match &function.params.items.first()?.pattern {
                BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn derived_function_reads_symbol(
    function_node_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            derived_nearest_function_id(reference.node_id(), ctx) == Some(function_node_id)
        })
}

fn derived_expression_is_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        == Some(symbol_id)
}

fn derived_symbol_has_state_source(
    symbol_id: SymbolId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && let BindingPattern::ArrayPattern(pattern) = &declarator.id
        && matches!(
            pattern.elements.first().and_then(Option::as_ref),
            Some(BindingPattern::BindingIdentifier(binding))
                if binding.symbol_id() == symbol_id
        )
        && declarator.init.as_ref().is_some_and(|initializer| {
            derived_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new())
        })
    {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if derived_nearest_function_id(declaration.id(), ctx) != Some(component_id) {
        return false;
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let has_state_source = ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !initializer.span().contains_inclusive(identifier.span) {
            return false;
        }
        let Some(source_symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        derived_symbol_has_state_source(source_symbol_id, component_id, ctx, visited_symbol_ids)
    });
    visited_symbol_ids.pop();
    has_state_source
}

fn derived_expression_references_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            expression
                .span()
                .contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
        })
}

fn derived_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn derived_function_is_async_or_generator(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(node_id).kind() {
        AstKind::Function(function) => function.r#async || function.generator,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn derived_enclosing_function_is_async_or_generator(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    derived_nearest_function_id(node_id, ctx).is_some_and(|function_node_id| {
        derived_function_is_async_or_generator(function_node_id, ctx)
    })
}

fn derived_resolve_use_state_pair<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, SymbolId)> {
    let resolved_symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()?;
    let setter_symbol_id = resolve_const_identifier_root_symbol(setter_identifier, ctx)?;
    derived_use_state_pair_from_setter_symbol(setter_symbol_id, ctx).or_else(|| {
        derived_upstream_use_state_pair(resolved_symbol_id, false, ctx, &mut Vec::new())
    })
}

fn derived_use_state_pair_from_setter_symbol(
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, SymbolId)> {
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state_binding) =
        pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    (setter_binding.symbol_id() == setter_symbol_id
        && derived_expression_is_use_state_tuple(declarator.init.as_ref()?, ctx, &mut Vec::new()))
    .then_some((state_binding.symbol_id(), setter_symbol_id))
}

fn derived_upstream_use_state_pair(
    symbol_id: SymbolId,
    allow_function_body: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<(SymbolId, SymbolId)> {
    if visited_symbol_ids.len() >= 8 || visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    if let Some(state_pair) = derived_use_state_pair_from_setter_symbol(symbol_id, ctx) {
        return Some(state_pair);
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let result = if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        )
        && declarator.init.as_ref().is_some_and(|initializer| {
            allow_function_body
                || (!matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) && derived_state_effect_unwrapped_callback_expression(
                    initializer,
                    ctx,
                    &mut Vec::new(),
                )
                .is_none())
        }) {
        let initializer = declarator.init.as_ref()?;
        ctx.nodes().iter().find_map(|candidate| {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return None;
            };
            if !initializer.span().contains_inclusive(candidate.span())
                || (!allow_function_body
                    && derived_identifier_is_inside_non_hook_callback_argument(
                        candidate.id(),
                        initializer,
                        ctx,
                    ))
            {
                return None;
            }
            let upstream_symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            (upstream_symbol_id != symbol_id).then(|| {
                derived_upstream_use_state_pair(upstream_symbol_id, true, ctx, visited_symbol_ids)
            })?
        })
    } else {
        None
    };
    visited_symbol_ids.pop();
    result
}

fn derived_identifier_is_inside_non_hook_callback_argument(
    node_id: NodeId,
    initializer: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if let Expression::CallExpression(call) = initializer.get_inner_expression() {
        let hook_name = match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name()),
        };
        if hook_name.is_some_and(derived_state_effect_is_hook_name) {
            return false;
        }
    }
    let initializer_span = initializer.span();
    for ancestor in ctx
        .nodes()
        .ancestors(node_id)
        .take_while(|ancestor| initializer_span.contains_inclusive(ancestor.span()))
    {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let function_root = transparent_expression_root(ancestor, ctx);
        let parent = ctx.nodes().parent_node(function_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return true;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_root.span())
        }) {
            return true;
        }
        let hook_name = match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name()),
        };
        return !hook_name.is_some_and(derived_state_effect_is_hook_name);
    }
    false
}

fn derived_state_effect_is_hook_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("use") else {
        return false;
    };
    suffix
        .as_bytes()
        .first()
        .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn derived_expression_is_use_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call_expression) => {
            is_react_hook_call(call_expression, &["useState"], ctx)
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
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let is_use_state_tuple = if let AstKind::VariableDeclarator(declarator) =
                declaration.kind()
                && matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                ) {
                declarator.init.as_ref().is_some_and(|initializer| {
                    derived_expression_is_use_state_tuple(initializer, ctx, visited_symbol_ids)
                })
            } else {
                false
            };
            visited_symbol_ids.pop();
            is_use_state_tuple
        }
        _ => false,
    }
}

fn derived_setter_has_independent_writer(
    setter_symbol_id: SymbolId,
    effect_span: oxc_span::Span,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if effect_span.contains_inclusive(reference_node.span()) {
                return false;
            }
            let root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            let is_writer =
                matches!(
                    parent.kind(),
                    AstKind::CallExpression(call)
                        if call.callee.span() == root.span()
                            || call.arguments.iter().any(|argument| {
                                argument
                                    .as_expression()
                                    .is_some_and(|expression| expression.span() == root.span())
                            })
                ) || is_inside_inline_event_handler(reference_node.id(), component_id, ctx);
            is_writer
                && (is_inside_inline_event_handler(reference_node.id(), component_id, ctx)
                    || derived_state_effect_has_reachable_event_call_path(
                        reference_node.id(),
                        component_id,
                        &mut Vec::new(),
                        ctx,
                    )
                    || derived_is_inside_deferred_writer(reference_node.id(), component_id, ctx))
        })
}

fn derived_state_effect_has_reachable_event_call_path(
    writer_node_id: NodeId,
    component_id: NodeId,
    visited_function_ids: &mut Vec<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(outermost_function_id) = ctx
        .nodes()
        .ancestors(writer_node_id)
        .take_while(|ancestor| ancestor.id() != component_id)
        .filter_map(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
            .then_some(ancestor.id())
        })
        .last()
        && derived_state_effect_function_is_referenced_from_jsx_event(
            outermost_function_id,
            component_id,
            ctx,
        )
    {
        return true;
    }
    let Some(function_id) =
        enclosing_event_handler_function_node_id(writer_node_id, component_id, ctx)
    else {
        return false;
    };
    derived_state_effect_function_has_reachable_event_call_path(
        function_id,
        component_id,
        visited_function_ids,
        ctx,
    )
}

fn derived_state_effect_function_is_referenced_from_jsx_event(
    function_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_symbol_id) = event_handler_function_symbol_id(function_id, ctx) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(function_symbol_id)
        .any(|reference| {
            derived_state_effect_is_inside_jsx_event_handler(reference.node_id(), component_id, ctx)
        })
}

fn derived_state_effect_function_has_reachable_event_call_path(
    function_id: NodeId,
    component_id: NodeId,
    visited_function_ids: &mut Vec<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if visited_function_ids.len() >= 8
        || visited_function_ids.contains(&function_id)
        || derived_function_is_async_or_generator(function_id, ctx)
        || !derived_state_effect_function_has_immutable_binding(function_id, ctx)
    {
        return false;
    }
    let Some(function_symbol_id) = event_handler_function_symbol_id(function_id, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(function_symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    visited_function_ids.push(function_id);
    let mut has_direct_event_path = false;
    let mut caller_function_ids = Vec::new();
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        if derived_state_effect_is_inside_jsx_event_handler(reference.node_id(), component_id, ctx)
            && !derived_state_effect_node_is_statically_unreachable(
                reference.node_id(),
                function_id,
                ctx,
            )
        {
            has_direct_event_path = true;
            continue;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        if derived_state_effect_is_hook_dependency_reference(reference_root, ctx) {
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            visited_function_ids.pop();
            return false;
        };
        if call_expression.callee.span() != reference_root.span() {
            visited_function_ids.pop();
            return false;
        }
        if derived_state_effect_node_is_statically_unreachable(parent.id(), function_id, ctx) {
            continue;
        }
        if derived_state_effect_is_inside_jsx_event_handler(parent.id(), component_id, ctx) {
            has_direct_event_path = true;
            continue;
        }
        let Some(caller_function_id) =
            enclosing_event_handler_function_node_id(parent.id(), component_id, ctx)
        else {
            continue;
        };
        caller_function_ids.push(caller_function_id);
    }
    if has_direct_event_path {
        visited_function_ids.pop();
        return true;
    }
    for caller_function_id in caller_function_ids {
        if derived_state_effect_function_has_reachable_event_call_path(
            caller_function_id,
            component_id,
            visited_function_ids,
            ctx,
        ) {
            visited_function_ids.pop();
            return true;
        }
    }
    visited_function_ids.pop();
    false
}

fn derived_state_effect_is_inside_jsx_event_handler(
    node_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_id)
        .any(|ancestor| {
            let AstKind::JSXAttribute(attribute) = ancestor.kind() else {
                return false;
            };
            let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name else {
                return false;
            };
            is_event_handler_name(identifier.name.as_str())
        })
}

fn derived_state_effect_function_has_immutable_binding(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if matches!(function_node.kind(), AstKind::Function(function) if function.is_function_declaration())
    {
        return true;
    }
    let Some(function_symbol_id) = event_handler_function_symbol_id(function_id, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(function_symbol_id);
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
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if initializer.span() == function_node.span() {
        return true;
    }
    let Expression::CallExpression(wrapper_call) = initializer.get_inner_expression() else {
        return false;
    };
    is_react_hook_call(wrapper_call, &["useCallback"], ctx)
        && wrapper_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|callback| callback.span() == function_node.span())
}

fn derived_state_effect_is_hook_dependency_reference(
    reference_root: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let array_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::ArrayExpression(array) = array_node.kind() else {
        return false;
    };
    if !array.elements.iter().any(|element| {
        element
            .as_expression()
            .is_some_and(|expression| expression.span() == reference_root.span())
    }) {
        return false;
    }
    let call_node = ctx.nodes().parent_node(array_node.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    call.arguments
        .get(1)
        .and_then(Argument::as_expression)
        .is_some_and(|dependencies| dependencies.span() == array_node.span())
        && match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                derived_state_effect_is_hook_name(identifier.name.as_str())
            }
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(derived_state_effect_is_hook_name),
        }
}

fn derived_state_effect_node_is_statically_unreachable(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let node_span = ctx.nodes().get_node(node_id).span();
    for ancestor in ctx
        .nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != function_id)
    {
        if let AstKind::IfStatement(if_statement) = ancestor.kind()
            && let Expression::BooleanLiteral(test) = if_statement.test.get_inner_expression()
        {
            if !test.value && if_statement.consequent.span().contains_inclusive(node_span) {
                return true;
            }
            if test.value
                && if_statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(node_span))
            {
                return true;
            }
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => Some(block.body.as_slice()),
            AstKind::FunctionBody(body) => Some(body.statements.as_slice()),
            _ => None,
        };
        if statements.is_some_and(|statements| {
            statements.iter().any(|statement| {
                matches!(statement, DerivedStateEffectStatement::ReturnStatement(_))
                    && statement.span().end <= node_span.start
            })
        }) {
            return true;
        }
    }
    false
}

fn derived_state_effect_has_cleanup(callback_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let mut has_cleanup = false;
    derived_for_each_returned_expression(callback_id, ctx, |returned_expression| {
        has_cleanup |= derived_function_expression_node_id(returned_expression).is_some();
    });
    has_cleanup
}

fn derived_state_effect_has_deferred_setter_writer(
    setter_symbol_id: SymbolId,
    effect_span: oxc_span::Span,
    component_id: NodeId,
    execution_node_ids: &DerivedStateEffectFxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let state_symbol_id = derived_use_state_pair_from_setter_symbol(setter_symbol_id, ctx)
        .map(|(state_symbol_id, _)| state_symbol_id);
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let call_node = ctx.nodes().parent_node(reference_root.id());
            if derived_state_effect_is_inside_cleanup_deferred_callback(
                call_node.id(),
                component_id,
                &mut Vec::new(),
                ctx,
            ) && (execution_node_ids.contains(&call_node.id())
                || effect_span.contains_inclusive(reference_node.span()))
            {
                return true;
            }
            if !execution_node_ids.contains(&call_node.id())
                || derived_enclosing_function_is_async_or_generator(call_node.id(), ctx)
            {
                return false;
            }
            let AstKind::CallExpression(setter_call) = call_node.kind() else {
                return false;
            };
            let Some(written_value) = setter_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                return false;
            };
            if derived_function_expression_node_id(written_value).is_some() {
                return false;
            }
            let Some(state_symbol_id) = state_symbol_id else {
                return false;
            };
            let is_render_known =
                derived_state_effect_setter_value_contexts(call_node, execution_node_ids, ctx)
                    .iter()
                    .any(|value_context| {
                        derived_written_value_is_render_known(
                            written_value,
                            component_id,
                            state_symbol_id,
                            ctx,
                            &mut Vec::new(),
                            &mut DerivedStateEffectFxHashSet::default(),
                            &value_context.substitutions,
                            1,
                        )
                    });
            !is_render_known
                && !derived_state_effect_expression_is_pure_constant(
                    written_value,
                    ctx,
                    &DerivedStateEffectFxHashMap::default(),
                    &mut Vec::new(),
                )
        })
}

fn derived_state_effect_is_inside_cleanup_deferred_callback(
    node_id: NodeId,
    component_id: NodeId,
    visited_function_ids: &mut Vec<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx
        .nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_id)
    {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if derived_state_effect_is_cleanup_deferred_callback_position(ancestor, ctx) {
            return true;
        }
        if visited_function_ids.contains(&ancestor.id()) {
            continue;
        }
        let Some(function_symbol_id) = event_handler_function_symbol_id(ancestor.id(), ctx) else {
            continue;
        };
        visited_function_ids.push(ancestor.id());
        let is_deferred = ctx
            .scoping()
            .get_resolved_references(function_symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                derived_state_effect_is_cleanup_deferred_callback_position(reference_node, ctx)
                    || derived_state_effect_is_inside_cleanup_deferred_callback(
                        reference_node.id(),
                        component_id,
                        visited_function_ids,
                        ctx,
                    )
            });
        visited_function_ids.pop();
        if is_deferred {
            return true;
        }
    }
    false
}

fn derived_state_effect_is_cleanup_deferred_callback_position<'a>(
    expression_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(expression_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|argument| argument.span() == expression_root.span())
    }) {
        return false;
    }
    derived_state_effect_deferring_callee_name(&call.callee).is_some_and(|name| {
        matches!(
            name,
            "setTimeout"
                | "setInterval"
                | "setImmediate"
                | "requestAnimationFrame"
                | "requestIdleCallback"
                | "queueMicrotask"
                | "then"
                | "catch"
                | "finally"
        )
    })
}

fn derived_is_inside_deferred_writer(
    node_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_id {
            return false;
        }
        let is_async = match ancestor.kind() {
            AstKind::Function(function) => function.r#async,
            AstKind::ArrowFunctionExpression(function) => function.r#async,
            _ => continue,
        };
        if is_async {
            return true;
        }
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            continue;
        };
        if !call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == ancestor.span())
        }) {
            continue;
        }
        let callee = call_expression.callee.get_inner_expression();
        let deferred_name = match callee {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name()),
        };
        if deferred_name.is_some_and(|name| {
            matches!(
                name,
                "addEventListener"
                    | "addListener"
                    | "catch"
                    | "finally"
                    | "requestAnimationFrame"
                    | "setInterval"
                    | "setTimeout"
                    | "subscribe"
                    | "then"
            )
        }) {
            return true;
        }
    }
    false
}

fn derived_effect_resets_source_state(
    source_state_symbol_id: SymbolId,
    derived_write_node: &AstNode<'_>,
    execution_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    execution_node_ids.iter().copied().any(|candidate_id| {
        let candidate = ctx.nodes().get_node(candidate_id);
        if derived_enclosing_function_is_async_or_generator(candidate.id(), ctx)
            || are_nodes_in_mutually_exclusive_branches(candidate, derived_write_node, ctx)
        {
            return false;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if call_expression.arguments.len() != 1 {
            return false;
        }
        let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression()
        else {
            return false;
        };
        derived_resolve_use_state_pair(identifier, ctx)
            .is_some_and(|(state_symbol_id, _)| state_symbol_id == source_state_symbol_id)
    })
}

fn derived_state_effect_setter_value_contexts<'node, 'ast>(
    setter_node: &'node AstNode<'ast>,
    execution_node_ids: &DerivedStateEffectFxHashSet<NodeId>,
    ctx: &'node LintContext<'ast>,
) -> Vec<DerivedValueContext<'node, 'ast>> {
    let Some(setter_function_id) = derived_nearest_function_id(setter_node.id(), ctx) else {
        return vec![DerivedValueContext {
            substitutions: DerivedStateEffectFxHashMap::default(),
            write_anchor: setter_node,
        }];
    };
    let parameter_symbol_ids = match ctx.nodes().get_node(setter_function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .map(|parameter| match &parameter.pattern {
                _ if parameter.initializer.is_some() => None,
                BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .map(|parameter| match &parameter.pattern {
                _ if parameter.initializer.is_some() => None,
                BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let mut contexts = Vec::new();
    for node_id in execution_node_ids {
        let call_node = ctx.nodes().get_node(*node_id);
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        if derived_state_effect_called_function_id(&call.callee, ctx) != Some(setter_function_id) {
            continue;
        }
        let substitutions = parameter_symbol_ids
            .iter()
            .enumerate()
            .filter_map(|(parameter_index, parameter_symbol_id)| {
                Some((
                    (*parameter_symbol_id)?,
                    call.arguments.get(parameter_index)?.as_expression()?,
                ))
            })
            .collect();
        contexts.push(DerivedValueContext {
            substitutions,
            write_anchor: call_node,
        });
    }
    for node_id in execution_node_ids {
        let call_node = ctx.nodes().get_node(*node_id);
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        let Some(member) = call.callee.as_member_expression() else {
            continue;
        };
        if !member
            .static_property_name()
            .is_some_and(|name| DERIVED_SYNCHRONOUS_ITERATOR_METHODS.contains(&name))
            || !call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|expression| {
                    exact_local_callback_function_id(expression, ctx, &mut Vec::new())
                        == Some(setter_function_id)
                })
            })
        {
            continue;
        }
        let mut substitutions = DerivedStateEffectFxHashMap::default();
        if let Some(Some(first_parameter_symbol_id)) = parameter_symbol_ids.first() {
            substitutions.insert(*first_parameter_symbol_id, member.object());
        }
        contexts.push(DerivedValueContext {
            substitutions,
            write_anchor: call_node,
        });
    }
    if contexts.is_empty() {
        contexts.push(DerivedValueContext {
            substitutions: DerivedStateEffectFxHashMap::default(),
            write_anchor: setter_node,
        });
    }
    contexts
}

fn derived_state_effect_called_function_id<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    derived_state_effect_called_function_id_internal(callee, ctx, &mut Vec::new())
}

fn derived_state_effect_called_function_id_internal<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match callee.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) if !function.generator => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_kind(declaration.id()),
                        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
                    ) =>
                {
                    derived_state_effect_called_function_id_internal(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            };
            visited_symbol_ids.pop();
            result
        }
        Expression::CallExpression(wrapper_call)
            if is_react_hook_call(wrapper_call, &["useCallback", "useEffectEvent"], ctx)
                || derived_state_effect_local_use_event_preserves_callback(
                    &wrapper_call.callee,
                    ctx,
                ) =>
        {
            derived_state_effect_called_function_id_internal(
                wrapper_call.arguments.first()?.as_expression()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn derived_state_effect_expand_synchronous_iterator_execution_nodes(
    execution_node_ids: &mut Vec<NodeId>,
    ctx: &LintContext<'_>,
) {
    let mut call_index = 0;
    while call_index < execution_node_ids.len() {
        let call_node = ctx.nodes().get_node(execution_node_ids[call_index]);
        call_index += 1;
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        if let Some(callback_function_id) =
            derived_state_effect_called_function_id(&call.callee, ctx)
        {
            for candidate in ctx.nodes().iter() {
                if derived_nearest_function_id(candidate.id(), ctx) == Some(callback_function_id)
                    && matches!(candidate.kind(), AstKind::CallExpression(_))
                    && !execution_node_ids.contains(&candidate.id())
                {
                    execution_node_ids.push(candidate.id());
                }
            }
        }
        let Some(member) = call.callee.as_member_expression() else {
            continue;
        };
        if !member
            .static_property_name()
            .is_some_and(|name| DERIVED_SYNCHRONOUS_ITERATOR_METHODS.contains(&name))
        {
            continue;
        }
        for callback_function_id in call.arguments.iter().filter_map(|argument| {
            exact_local_callback_function_id(argument.as_expression()?, ctx, &mut Vec::new())
        }) {
            for candidate in ctx.nodes().iter() {
                if derived_nearest_function_id(candidate.id(), ctx) == Some(callback_function_id)
                    && matches!(candidate.kind(), AstKind::CallExpression(_))
                    && !execution_node_ids.contains(&candidate.id())
                {
                    execution_node_ids.push(candidate.id());
                }
            }
        }
    }
}

fn derived_expression_is_render_known<'node, 'ast>(
    expression: &Expression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut DerivedStateEffectFxHashSet<SymbolId>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    if let Expression::ConditionalExpression(conditional) = expression.get_inner_expression()
        && matches!(
            conditional.alternate.get_inner_expression(),
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        )
        && let Expression::CallExpression(transform_call) =
            conditional.consequent.get_inner_expression()
        && let Some(transform_member) = transform_call.callee.as_member_expression()
        && transform_member
            .static_property_name()
            .is_some_and(|name| DERIVED_PURE_MEMBER_CALLS.contains(&name))
        && transform_call.arguments.iter().all(|argument| {
            argument.as_expression().is_none_or(|argument| {
                matches!(
                    argument.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
        })
        && derived_expression_is_render_known(
            &conditional.test,
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            substitutions,
            remaining_call_frames,
        )
        && derived_expression_is_render_known(
            transform_member.object(),
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            substitutions,
            remaining_call_frames,
        )
    {
        return true;
    }
    if matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let expression_span = expression.span();
    let mut has_source = false;
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        if derived_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if candidate.span() != expression_span =>
            {
                if derived_function_is_ignored_pure_callback(candidate, ctx) {
                    continue;
                }
                return false;
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(new_expression)
                if !matches!(
                    new_expression.callee.get_inner_expression(),
                    Expression::Identifier(identifier)
                        if matches!(identifier.name.as_str(), "Date" | "Set")
                            && derived_identifier_is_global(identifier, ctx)
                ) =>
            {
                return false;
            }
            AstKind::CallExpression(call_expression)
                if !derived_is_pure_call(call_expression, ctx) =>
            {
                if !derived_state_effect_value_helper_call_is_render_known(
                    call_expression,
                    component_id,
                    written_state_symbol_id,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
                has_source = true;
            }
            AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)
                if derived_member_has_locally_constructed_receiver(candidate, ctx) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    if !matches!(
                        identifier.name.as_str(),
                        "Array"
                            | "BigInt"
                            | "Boolean"
                            | "Date"
                            | "Infinity"
                            | "JSON"
                            | "Math"
                            | "NaN"
                            | "Number"
                            | "Object"
                            | "Set"
                            | "String"
                            | "encodeURIComponent"
                            | "parseFloat"
                            | "parseInt"
                            | "structuredClone"
                            | "undefined"
                    ) {
                        return false;
                    }
                    continue;
                };
                if symbol_id == written_state_symbol_id {
                    return false;
                }
                if derived_state_effect_identifier_is_ref_current_object(candidate, symbol_id, ctx)
                    || derived_state_effect_identifier_is_value_helper_callee(
                        candidate, symbol_id, ctx,
                    )
                {
                    continue;
                }
                if let Some(substitution) = substitutions.get(&symbol_id) {
                    if !derived_expression_is_render_known(
                        substitution,
                        component_id,
                        written_state_symbol_id,
                        ctx,
                        visited_symbol_ids,
                        source_state_symbols,
                        substitutions,
                        remaining_call_frames,
                    ) {
                        return false;
                    }
                    has_source = true;
                    continue;
                }
                if matches!(
                    ctx.symbol_declaration(symbol_id).kind(),
                    AstKind::FormalParameter(_)
                ) && derived_state_effect_identifier_is_object_spread(candidate, ctx)
                {
                    continue;
                }
                let Some(is_source) = derived_symbol_is_render_known(
                    symbol_id,
                    component_id,
                    written_state_symbol_id,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                    substitutions,
                    remaining_call_frames,
                ) else {
                    return false;
                };
                has_source |= is_source;
            }
            AstKind::StaticMemberExpression(member)
                if member.property.name == "current"
                    && derived_expression_is_ref_value(&member.object, ctx) =>
            {
                if !derived_state_effect_ref_current_is_render_known(
                    &member.object,
                    component_id,
                    written_state_symbol_id,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
                has_source = true;
            }
            AstKind::ComputedMemberExpression(member)
                if member.static_property_name().as_deref() == Some("current")
                    && derived_expression_is_ref_value(&member.object, ctx) =>
            {
                if !derived_state_effect_ref_current_is_render_known(
                    &member.object,
                    component_id,
                    written_state_symbol_id,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                    substitutions,
                    remaining_call_frames,
                ) {
                    return false;
                }
                has_source = true;
            }
            AstKind::StaticMemberExpression(member) if member.property.name == "current" => {
                return false;
            }
            AstKind::ComputedMemberExpression(member)
                if member.static_property_name().as_deref() == Some("current") =>
            {
                return false;
            }
            _ => {}
        }
    }
    has_source
}

fn derived_state_effect_identifier_is_object_spread(
    identifier_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let spread_node = ctx.nodes().parent_node(identifier_node.id());
    let AstKind::SpreadElement(spread) = spread_node.kind() else {
        return false;
    };
    if spread.argument.span() != identifier_node.span() {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(spread_node.id()).kind(),
        AstKind::ObjectExpression(_)
    )
}

fn derived_written_value_is_render_known<'node, 'ast>(
    expression: &Expression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut DerivedStateEffectFxHashSet<SymbolId>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    let Some(function_node_id) = derived_function_expression_node_id(expression) else {
        return derived_expression_is_render_known(
            expression,
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            substitutions,
            remaining_call_frames,
        );
    };
    let mut returned_expression_count = 0;
    let mut has_render_known_source = false;
    let mut all_returns_are_render_known = true;
    derived_for_each_returned_expression(function_node_id, ctx, |returned_expression| {
        returned_expression_count += 1;
        let return_has_render_known_source = derived_expression_is_render_known(
            returned_expression,
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            substitutions,
            remaining_call_frames,
        );
        has_render_known_source |= return_has_render_known_source;
        all_returns_are_render_known &= return_has_render_known_source;
    });
    returned_expression_count > 0 && has_render_known_source && all_returns_are_render_known
}

#[allow(clippy::too_many_arguments)]
fn derived_state_effect_value_helper_call_is_render_known<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut DerivedStateEffectFxHashSet<SymbolId>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    let local_function_id = derived_state_effect_called_function_id(&call.callee, ctx);
    let is_module_helper = local_function_id
        .is_some_and(|function_id| derived_state_effect_function_is_module_level(function_id, ctx));
    let local_helper_summary = local_function_id
        .filter(|_| is_module_helper)
        .and_then(|function_id| derived_state_effect_local_helper_summary(function_id, ctx));
    if is_module_helper && local_helper_summary.is_none() {
        return false;
    }
    let used_parameter_indices =
        local_helper_summary.or_else(|| derived_state_effect_imported_helper_summary(call, ctx));
    if let Some(used_parameter_indices) = used_parameter_indices {
        let arguments = call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .collect::<Vec<_>>();
        let mut has_source = false;
        for parameter_index in used_parameter_indices {
            let Some(argument) = arguments.get(parameter_index) else {
                return false;
            };
            let argument_has_source = derived_expression_is_render_known(
                argument,
                component_id,
                written_state_symbol_id,
                ctx,
                visited_symbol_ids,
                source_state_symbols,
                substitutions,
                remaining_call_frames,
            );
            if !argument_has_source
                && !derived_state_effect_expression_is_pure_constant(
                    argument,
                    ctx,
                    substitutions,
                    &mut Vec::new(),
                )
            {
                return false;
            }
            has_source |= argument_has_source;
        }
        return has_source;
    }
    if remaining_call_frames == 0 {
        return false;
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(function_id) = derived_state_effect_called_function_id(&call.callee, ctx) else {
        return false;
    };
    if derived_function_is_async_or_generator(function_id, ctx) {
        return false;
    }
    let Some(callee_symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&callee_symbol_id) {
        return false;
    }
    let parameter_symbol_ids = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return false,
    }
    .iter()
    .map(|parameter| match &parameter.pattern {
        _ if parameter.initializer.is_some() => None,
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        _ => None,
    })
    .collect::<Vec<_>>();
    let mut helper_substitutions = substitutions.clone();
    for (parameter_index, parameter_symbol_id) in parameter_symbol_ids.iter().enumerate() {
        let Some(parameter_symbol_id) = parameter_symbol_id else {
            continue;
        };
        let Some(argument) = call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        helper_substitutions.insert(*parameter_symbol_id, argument);
    }
    visited_symbol_ids.push(callee_symbol_id);
    let mut return_count = 0;
    let mut all_returns_are_render_known = true;
    derived_for_each_returned_expression(function_id, ctx, |returned_expression| {
        return_count += 1;
        all_returns_are_render_known &= derived_expression_is_render_known(
            returned_expression,
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            &helper_substitutions,
            remaining_call_frames - 1,
        );
    });
    visited_symbol_ids.pop();
    return_count > 0 && all_returns_are_render_known
}

fn derived_state_effect_function_is_module_level(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    !ctx.nodes().ancestors(function_id).any(|ancestor| {
        ancestor.id() != function_id
            && matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
    })
}

fn derived_state_effect_function_is_component_or_hook(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function.id.as_ref().is_none_or(|identifier| {
            derived_state_effect_is_component_or_hook_name(identifier.name.as_str())
        }) || matches!(
            ctx.nodes().parent_node(function_id).kind(),
            AstKind::ExportDefaultDeclaration(_)
        );
    }
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        if matches!(parent.kind(), AstKind::CallExpression(_)) {
            expression_root = transparent_expression_root(parent, ctx);
            continue;
        }
        return match parent.kind() {
            AstKind::VariableDeclarator(declarator) => declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| {
                    derived_state_effect_is_component_or_hook_name(identifier.name.as_str())
                }),
            AstKind::ExportDefaultDeclaration(_) => true,
            _ => false,
        };
    }
}

fn derived_state_effect_is_component_or_hook_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        || (name.starts_with("use")
            && name.as_bytes().get(3).is_some_and(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            }))
}

fn derived_state_effect_expression_is_pure_constant<'node, 'ast>(
    expression: &Expression<'ast>,
    ctx: &LintContext<'ast>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span())
            || derived_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if candidate.span() != expression_span =>
            {
                if !derived_function_is_ignored_pure_callback(candidate, ctx) {
                    return false;
                }
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(construction) => {
                let Expression::Identifier(identifier) = construction.callee.get_inner_expression()
                else {
                    return false;
                };
                if !matches!(identifier.name.as_str(), "Date" | "Set")
                    || !derived_identifier_is_global(identifier, ctx)
                {
                    return false;
                }
            }
            AstKind::CallExpression(call) if !derived_is_pure_call(call, ctx) => return false,
            AstKind::IdentifierReference(identifier) => {
                if derived_identifier_is_callee(candidate.id(), ctx) {
                    continue;
                }
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    if !derived_state_effect_identifier_name_is_allowed_global(
                        identifier.name.as_str(),
                    ) {
                        return false;
                    }
                    continue;
                };
                if let Some(substitution) = substitutions.get(&symbol_id) {
                    if !derived_state_effect_expression_is_pure_constant(
                        substitution,
                        ctx,
                        substitutions,
                        visited_symbol_ids,
                    ) {
                        return false;
                    }
                    continue;
                }
                if visited_symbol_ids.contains(&symbol_id) {
                    return false;
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return false;
                };
                if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                {
                    return false;
                }
                visited_symbol_ids.push(symbol_id);
                let is_constant = declarator.init.as_ref().is_some_and(|initializer| {
                    derived_state_effect_expression_is_pure_constant(
                        initializer,
                        ctx,
                        substitutions,
                        visited_symbol_ids,
                    )
                });
                visited_symbol_ids.pop();
                if !is_constant {
                    return false;
                }
            }
            AstKind::StaticMemberExpression(member)
                if member.property.name == "current"
                    && derived_expression_is_ref_value(&member.object, ctx) =>
            {
                return false;
            }
            AstKind::ComputedMemberExpression(member)
                if member.static_property_name().as_deref() == Some("current")
                    && derived_expression_is_ref_value(&member.object, ctx) =>
            {
                return false;
            }
            _ => {}
        }
    }
    true
}

fn derived_function_expression_node_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn derived_for_each_returned_expression<'a>(
    function_node_id: NodeId,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&Expression<'a>),
) {
    if let AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_node_id).kind()
        && let Some(expression) = function.get_expression()
    {
        visitor(expression);
        return;
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if derived_nearest_function_id(candidate.id(), ctx) == Some(function_node_id)
            && let Some(returned_expression) = &return_statement.argument
        {
            visitor(returned_expression);
        }
    }
}

fn derived_expression_is_ref_value<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    derived_symbol_is_ref_value(symbol_id, ctx, &mut Vec::new())
}

fn derived_symbol_is_ref_value(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let is_ref_value = if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        declarator.init.as_ref().is_some_and(|initializer| {
            match initializer.get_inner_expression() {
                Expression::CallExpression(call_expression) => {
                    is_react_hook_call(call_expression, &["useRef"], ctx)
                }
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|source_symbol_id| {
                        derived_symbol_is_ref_value(source_symbol_id, ctx, visited_symbol_ids)
                    }),
                _ => false,
            }
        })
    } else {
        false
    };
    visited_symbol_ids.pop();
    is_ref_value
}

fn derived_state_effect_identifier_is_ref_current_object<'a>(
    identifier_node: &AstNode<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes()
        .parent_node(identifier_node.id())
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| {
            member.object().span() == identifier_node.span()
                && member.static_property_name().as_deref() == Some("current")
                && derived_symbol_is_ref_value(symbol_id, ctx, &mut Vec::new())
        })
}

fn derived_state_effect_identifier_is_value_helper_callee<'a>(
    identifier_node: &AstNode<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(identifier_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.callee.span() == identifier_node.span()
        && ctx
            .scoping()
            .get_reference(match identifier_node.kind() {
                AstKind::IdentifierReference(identifier) => identifier.reference_id(),
                _ => return false,
            })
            .symbol_id()
            == Some(symbol_id)
        && (derived_state_effect_called_function_id(&call.callee, ctx).is_some()
            || derived_state_effect_imported_helper_summary(call, ctx).is_some())
}

#[allow(clippy::too_many_arguments)]
fn derived_state_effect_ref_current_is_render_known<'node, 'ast>(
    object: &Expression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut DerivedStateEffectFxHashSet<SymbolId>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(ref_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !is_react_hook_call(ref_call, &["useRef"], ctx) {
        return false;
    }
    let mut values = ref_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .into_iter()
        .collect::<Vec<_>>();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        let member_node = ctx.nodes().parent_node(reference_root.id());
        let Some(member) = member_node.kind().as_member_expression_kind() else {
            return false;
        };
        if member.object().span() != reference_root.span()
            || member.static_property_name().as_deref() != Some("current")
        {
            return false;
        }
        let member_root = transparent_expression_root(member_node, ctx);
        let parent = ctx.nodes().parent_node(member_root.id());
        match parent.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.left.span() == member_root.span() =>
            {
                if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign {
                    return false;
                }
                values.push(&assignment.right);
            }
            AstKind::UpdateExpression(_) => return false,
            _ => {}
        }
    }
    if values.is_empty() {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let mut has_source = false;
    for value in values {
        if !derived_expression_is_render_known(
            value,
            component_id,
            written_state_symbol_id,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
            substitutions,
            remaining_call_frames,
        ) {
            visited_symbol_ids.pop();
            return false;
        }
        has_source = true;
    }
    visited_symbol_ids.pop();
    has_source
}

fn derived_is_inside_ignored_pure_callback(
    node_id: NodeId,
    expression_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| derived_function_is_ignored_pure_callback(ancestor, ctx))
}

fn derived_function_is_ignored_pure_callback(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) && derived_is_pure_call(call_expression, ctx)
}

fn derived_identifier_is_callee(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let node = ctx.nodes().get_node(node_id);
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == root.span())
}

fn derived_symbol_is_render_known<'node, 'ast>(
    symbol_id: SymbolId,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut DerivedStateEffectFxHashSet<SymbolId>,
    substitutions: &DerivedStateEffectFxHashMap<SymbolId, &'node Expression<'ast>>,
    remaining_call_frames: usize,
) -> Option<bool> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::FormalParameter(_)
            if derived_state_effect_symbol_is_component_parameter(symbol_id, component_id, ctx)
                && derived_state_effect_function_is_component_or_hook(component_id, ctx) =>
        {
            Some(true)
        }
        AstKind::VariableDeclarator(declarator) => {
            if let BindingPattern::ArrayPattern(pattern) = &declarator.id
                && matches!(
                    pattern.elements.first().and_then(Option::as_ref),
                    Some(BindingPattern::BindingIdentifier(binding))
                        if binding.symbol_id() == symbol_id
                )
                && declarator.init.as_ref().is_some_and(|initializer| {
                    derived_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new())
                })
            {
                if derived_state_effect_state_is_externally_driven(symbol_id, component_id, ctx) {
                    return None;
                }
                source_state_symbols.insert(symbol_id);
                return Some(true);
            }
            let assignment_writes = ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .filter(|reference| reference.is_write())
                .collect::<Vec<_>>();
            if let [assignment_write] = assignment_writes.as_slice() {
                let assignment_target = ctx.nodes().get_node(assignment_write.node_id());
                let assignment_root = transparent_expression_root(assignment_target, ctx);
                let assignment_node = ctx.nodes().parent_node(assignment_root.id());
                if let AstKind::AssignmentExpression(assignment) = assignment_node.kind()
                    && assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                    && assignment.left.span() == assignment_root.span()
                {
                    visited_symbol_ids.push(symbol_id);
                    let is_render_known = derived_expression_is_render_known(
                        &assignment.right,
                        component_id,
                        written_state_symbol_id,
                        ctx,
                        visited_symbol_ids,
                        source_state_symbols,
                        substitutions,
                        remaining_call_frames,
                    );
                    visited_symbol_ids.pop();
                    return is_render_known.then_some(true);
                }
                return None;
            }
            if !assignment_writes.is_empty() {
                return None;
            }
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let is_render_known = derived_expression_is_render_known(
                declarator.init.as_ref()?,
                component_id,
                written_state_symbol_id,
                ctx,
                visited_symbol_ids,
                source_state_symbols,
                substitutions,
                remaining_call_frames,
            );
            visited_symbol_ids.pop();
            is_render_known.then_some(true)
        }
        _ => None,
    }
}

fn derived_state_effect_symbol_is_component_parameter(
    symbol_id: SymbolId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration_span = ctx.symbol_declaration(symbol_id).span();
    match ctx.nodes().get_node(component_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .iter()
            .any(|parameter| parameter.span().contains_inclusive(declaration_span)),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .iter()
            .any(|parameter| parameter.span().contains_inclusive(declaration_span)),
        _ => false,
    }
}

fn derived_state_effect_state_is_externally_driven(
    state_symbol_id: SymbolId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(setter)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return false;
    };
    let mut has_deferred_call = false;
    for reference in ctx.scoping().get_resolved_references(setter.symbol_id()) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        if derived_state_effect_is_deferred_callback_position(reference_root, ctx) {
            has_deferred_call = true;
            continue;
        }
        let parent = ctx.nodes().parent_node(reference_root.id());
        if !matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == reference_root.span())
        {
            continue;
        }
        if !derived_state_effect_is_inside_deferred_callback(parent.id(), component_id, ctx) {
            return false;
        }
        has_deferred_call = true;
    }
    has_deferred_call
}

fn derived_state_effect_is_inside_deferred_callback(
    node_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx
        .nodes()
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != component_id)
    {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if derived_state_effect_is_deferred_callback_position(ancestor, ctx) {
            return true;
        }
        let Some(function_symbol_id) = event_handler_function_symbol_id(ancestor.id(), ctx) else {
            continue;
        };
        if ctx
            .scoping()
            .get_resolved_references(function_symbol_id)
            .any(|reference| {
                derived_state_effect_is_deferred_callback_position(
                    ctx.nodes().get_node(reference.node_id()),
                    ctx,
                )
            })
        {
            return true;
        }
    }
    false
}

fn derived_state_effect_is_deferred_callback_position<'a>(
    expression_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(expression_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::CallExpression(call)
            if call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == expression_root.span())
            }) =>
        {
            derived_state_effect_deferring_callee_name(&call.callee).is_some_and(|name| {
                matches!(
                    name,
                    "setTimeout"
                        | "setInterval"
                        | "setImmediate"
                        | "requestAnimationFrame"
                        | "requestIdleCallback"
                        | "queueMicrotask"
                        | "addEventListener"
                        | "addListener"
                        | "subscribe"
                        | "observe"
                        | "watch"
                        | "watchPosition"
                        | "then"
                        | "catch"
                        | "finally"
                        | "on"
                        | "once"
                )
            })
        }
        AstKind::NewExpression(construction)
            if construction.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == expression_root.span())
            }) =>
        {
            derived_state_effect_deferring_callee_name(&construction.callee)
                .is_some_and(|name| name == "Promise" || name.ends_with("Observer"))
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == expression_root.span() =>
        {
            assignment
                .left
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(|name| name.starts_with("on"))
        }
        _ => false,
    }
}

fn derived_state_effect_deferring_callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    }
}

fn derived_member_has_locally_constructed_receiver(
    member_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let object = match member_node.kind() {
        AstKind::StaticMemberExpression(member) => &member.object,
        AstKind::ComputedMemberExpression(member) => &member.object,
        _ => return false,
    };
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
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
    declarator.init.as_ref().is_some_and(|initializer| {
        matches!(
            initializer.get_inner_expression(),
            Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
        )
    })
}

fn derived_state_effect_local_helper_summary(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<DerivedStateEffectFxHashSet<usize>> {
    let function_node = ctx.nodes().get_node(function_id);
    let (is_async_or_generator, parameters, statements, expression) = match function_node.kind() {
        AstKind::Function(function) => (
            function.r#async || function.generator,
            &function.params.items,
            function
                .body
                .as_ref()
                .map(|body| body.statements.as_slice()),
            None,
        ),
        AstKind::ArrowFunctionExpression(function) => (
            function.r#async,
            &function.params.items,
            function
                .body
                .as_function_body()
                .map(|body| body.statements.as_slice()),
            function.get_expression(),
        ),
        _ => return None,
    };
    if is_async_or_generator {
        return None;
    }
    let mut parameter_indices = DerivedStateEffectFxHashMap::default();
    for (parameter_index, parameter) in parameters.iter().enumerate() {
        let BindingPattern::BindingIdentifier(binding) = &parameter.pattern else {
            return None;
        };
        parameter_indices.insert(binding.symbol_id(), parameter_index);
    }
    let mut used_parameter_indices = DerivedStateEffectFxHashSet::default();
    let mut visited_symbol_ids = Vec::new();
    if let Some(expression) = expression {
        return derived_state_effect_local_helper_expression_is_pure(
            expression,
            function_id,
            ctx,
            &parameter_indices,
            &mut used_parameter_indices,
            &mut visited_symbol_ids,
        )
        .then_some(used_parameter_indices);
    }
    let can_continue = derived_state_effect_local_helper_statements_can_continue(
        statements?,
        function_id,
        ctx,
        &parameter_indices,
        &mut used_parameter_indices,
        &mut visited_symbol_ids,
    )?;
    (!can_continue).then_some(used_parameter_indices)
}

fn derived_state_effect_local_helper_statements_can_continue<'a>(
    statements: &'a [DerivedStateEffectStatement<'a>],
    function_id: NodeId,
    ctx: &LintContext<'a>,
    parameter_indices: &DerivedStateEffectFxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut DerivedStateEffectFxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<bool> {
    let mut can_continue = true;
    for statement in statements {
        if !can_continue {
            if !matches!(statement, DerivedStateEffectStatement::EmptyStatement(_)) {
                return None;
            }
            continue;
        }
        match statement {
            DerivedStateEffectStatement::EmptyStatement(_) => {}
            DerivedStateEffectStatement::VariableDeclaration(declaration)
                if declaration.kind.is_const() =>
            {
                for declarator in &declaration.declarations {
                    declarator.id.get_binding_identifier()?;
                    if !derived_state_effect_local_helper_expression_is_pure(
                        declarator.init.as_ref()?,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                }
            }
            DerivedStateEffectStatement::ReturnStatement(statement) => {
                if !derived_state_effect_local_helper_expression_is_pure(
                    statement.argument.as_ref()?,
                    function_id,
                    ctx,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                ) {
                    return None;
                }
                can_continue = false;
            }
            DerivedStateEffectStatement::BlockStatement(block) => {
                can_continue = derived_state_effect_local_helper_statements_can_continue(
                    &block.body,
                    function_id,
                    ctx,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                )?;
            }
            DerivedStateEffectStatement::IfStatement(statement) => {
                if !derived_state_effect_local_helper_expression_is_pure(
                    &statement.test,
                    function_id,
                    ctx,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                ) {
                    return None;
                }
                let consequent_can_continue =
                    derived_state_effect_local_helper_statements_can_continue(
                        std::slice::from_ref(&statement.consequent),
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?;
                let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                    derived_state_effect_local_helper_statements_can_continue(
                        std::slice::from_ref(alternate),
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?
                } else {
                    true
                };
                can_continue = consequent_can_continue || alternate_can_continue;
            }
            _ => return None,
        }
    }
    Some(can_continue)
}

fn derived_state_effect_local_helper_expression_is_pure<'a>(
    expression: &Expression<'a>,
    function_id: NodeId,
    ctx: &LintContext<'a>,
    parameter_indices: &DerivedStateEffectFxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut DerivedStateEffectFxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if candidate.id() != function_id
                    && derived_function_is_async_or_generator(candidate.id(), ctx) =>
            {
                return false;
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(construction) => {
                let Expression::Identifier(identifier) = construction.callee.get_inner_expression()
                else {
                    return false;
                };
                if !matches!(identifier.name.as_str(), "Date" | "Set")
                    || !derived_identifier_is_global(identifier, ctx)
                {
                    return false;
                }
            }
            AstKind::CallExpression(call)
                if !derived_state_effect_local_helper_call_is_pure(call, ctx) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    if !derived_state_effect_identifier_name_is_allowed_global(
                        identifier.name.as_str(),
                    ) {
                        return false;
                    }
                    continue;
                };
                if let Some(parameter_index) = parameter_indices.get(&symbol_id) {
                    used_parameter_indices.insert(*parameter_index);
                    continue;
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                if matches!(declaration.kind(), AstKind::FormalParameter(_))
                    && expression_span.contains_inclusive(declaration.span())
                {
                    continue;
                }
                if derived_identifier_is_callee(candidate.id(), ctx) {
                    continue;
                }
                if visited_symbol_ids.contains(&symbol_id) {
                    return false;
                }
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return false;
                };
                if !expression_span.contains_inclusive(declaration.span())
                    || !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                {
                    return false;
                }
                visited_symbol_ids.push(symbol_id);
                let is_pure = declarator.init.as_ref().is_some_and(|initializer| {
                    derived_state_effect_local_helper_expression_is_pure(
                        initializer,
                        function_id,
                        ctx,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )
                });
                visited_symbol_ids.pop();
                if !is_pure {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

fn derived_state_effect_identifier_name_is_allowed_global(name: &str) -> bool {
    matches!(
        name,
        "Array"
            | "BigInt"
            | "Boolean"
            | "Date"
            | "Infinity"
            | "JSON"
            | "Math"
            | "NaN"
            | "Number"
            | "Object"
            | "Set"
            | "String"
            | "encodeURIComponent"
            | "parseFloat"
            | "parseInt"
            | "structuredClone"
            | "undefined"
    )
}

fn derived_state_effect_imported_helper_summary<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<DerivedStateEffectFxHashSet<usize>> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let import_entry = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })?;
    let exported_name = match &import_entry.import_name {
        DerivedStateEffectImportImportName::Name(name) => name.name(),
        DerivedStateEffectImportImportName::Default(_) => "default",
        DerivedStateEffectImportImportName::NamespaceObject => return None,
    };
    if !ctx.file_path().is_absolute() {
        return None;
    }
    let helper_path = derived_state_effect_resolve_first_party_module_path(
        ctx.file_path(),
        import_entry.module_request.name(),
    )?;
    derived_state_effect_foreign_helper_summary(
        &helper_path,
        exported_name,
        0,
        &mut DerivedStateEffectFxHashSet::default(),
    )
}

fn derived_state_effect_resolve_first_party_module_path(
    from_file_path: &DerivedStateEffectPath,
    module_source: &str,
) -> Option<DerivedStateEffectPathBuf> {
    if DerivedStateEffectPath::new(module_source).is_absolute() {
        return None;
    }
    let resolver = DerivedStateEffectResolver::new(DerivedStateEffectResolveOptions {
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
            .into_iter()
            .map(String::from)
            .collect(),
        main_fields: vec!["module".into(), "main".into(), "browser".into()],
        condition_names: vec![
            "import".into(),
            "default".into(),
            "module".into(),
            "browser".into(),
            "require".into(),
        ],
        extension_alias: vec![
            (
                ".js".into(),
                vec![".js".into(), ".ts".into(), ".tsx".into(), ".jsx".into()],
            ),
            (".jsx".into(), vec![".jsx".into(), ".tsx".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(DerivedStateEffectTsconfigDiscovery::Auto),
        ..DerivedStateEffectResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    if resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules")
        || resolved_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".d.ts"))
    {
        return None;
    }
    Some(resolved_path)
}

fn derived_state_effect_foreign_helper_summary(
    file_path: &DerivedStateEffectPath,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut DerivedStateEffectFxHashSet<DerivedStateEffectPathBuf>,
) -> Option<DerivedStateEffectFxHashSet<usize>> {
    if depth >= DERIVED_MAX_IMPORTED_HELPER_DEPTH {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).ok()?;
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = DerivedStateEffectSourceType::from_path(file_path).ok()?;
    let allocator = DerivedStateEffectAllocator::default();
    let parser_return = DerivedStateEffectParser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = DerivedStateEffectSemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record =
        DerivedStateEffectModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_id) =
        derived_state_effect_foreign_exported_function_id(exported_name, &semantic, &module_record)
    {
        return derived_state_effect_foreign_function_summary(function_id, &semantic);
    }
    if exported_name == "default"
        && let Some(function_id) = derived_state_effect_foreign_default_function_id(&semantic)
    {
        return derived_state_effect_foreign_function_summary(function_id, &semantic);
    }
    if let Some((module_source, imported_name)) =
        derived_state_effect_foreign_reexport_target(exported_name, &module_record)
        && let Some(reexport_path) =
            derived_state_effect_resolve_first_party_module_path(file_path, module_source)
    {
        return derived_state_effect_foreign_helper_summary(
            &reexport_path,
            imported_name,
            depth + 1,
            &mut visited_paths.clone(),
        );
    }
    let mut resolved_export_all = None;
    for statement in &program.body {
        let DerivedStateEffectStatement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(reexport_path) = derived_state_effect_resolve_first_party_module_path(
            file_path,
            declaration.source.value.as_str(),
        ) else {
            continue;
        };
        let Some(candidate) = derived_state_effect_foreign_helper_summary(
            &reexport_path,
            exported_name,
            depth + 1,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if resolved_export_all.is_some() {
            return None;
        }
        resolved_export_all = Some(candidate);
    }
    resolved_export_all
}

fn derived_state_effect_foreign_exported_function_id(
    exported_name: &str,
    semantic: &DerivedStateEffectSemantic<'_>,
    module_record: &DerivedStateEffectModuleRecord,
) -> Option<NodeId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let matches = match &entry.export_name {
                DerivedStateEffectExportExportName::Name(name) => name.name() == exported_name,
                DerivedStateEffectExportExportName::Default(_) => exported_name == "default",
                DerivedStateEffectExportExportName::Null => false,
            };
            matches.then(|| entry.local_name.name()).flatten()
        })?;
    let symbol_id = semantic.scoping().get_root_binding(local_name.into())?;
    derived_state_effect_foreign_function_id_for_symbol(
        symbol_id,
        local_name,
        semantic,
        &mut Vec::new(),
    )
}

fn derived_state_effect_foreign_default_function_id(
    semantic: &DerivedStateEffectSemantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            DerivedStateEffectExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                function.body.as_ref().map(|_| function.node_id.get())
            }
            DerivedStateEffectExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                Some(function.node_id.get())
            }
            declaration => {
                let Expression::Identifier(identifier) =
                    declaration.as_expression()?.get_inner_expression()
                else {
                    return None;
                };
                let symbol_id = semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                derived_state_effect_foreign_function_id_for_symbol(
                    symbol_id,
                    identifier.name.as_str(),
                    semantic,
                    &mut Vec::new(),
                )
            }
        }
    })
}

fn derived_state_effect_foreign_function_id_for_symbol(
    symbol_id: SymbolId,
    symbol_name: &str,
    semantic: &DerivedStateEffectSemantic<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = semantic.symbol_declaration(symbol_id);
    let result = match declaration.kind() {
        AstKind::Function(function) if function.body.is_some() => Some(function.node_id.get()),
        AstKind::Function(_) => semantic.nodes().iter().find_map(|node| {
            let AstKind::Function(function) = node.kind() else {
                return None;
            };
            (function.body.is_some()
                && function
                    .id
                    .as_ref()
                    .is_some_and(|identifier| identifier.name == symbol_name))
            .then_some(function.node_id.get())
        }),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .and_then(|alias_symbol_id| {
                        derived_state_effect_foreign_function_id_for_symbol(
                            alias_symbol_id,
                            identifier.name.as_str(),
                            semantic,
                            visited_symbol_ids,
                        )
                    }),
                _ => None,
            }
        }
        _ => None,
    };
    visited_symbol_ids.pop();
    result
}

fn derived_state_effect_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a DerivedStateEffectModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let entry_exported_name = match &entry.export_name {
                DerivedStateEffectExportExportName::Name(name) => name.name(),
                DerivedStateEffectExportExportName::Default(_) => "default",
                DerivedStateEffectExportExportName::Null => return None,
            };
            if entry_exported_name != exported_name {
                return None;
            }
            let source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                crate::module_record::ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((source, imported_name))
        })
}

fn derived_state_effect_foreign_function_summary(
    function_id: NodeId,
    semantic: &DerivedStateEffectSemantic<'_>,
) -> Option<DerivedStateEffectFxHashSet<usize>> {
    let function_node = semantic.nodes().get_node(function_id);
    let (is_async_or_generator, parameters, statements, expression) = match function_node.kind() {
        AstKind::Function(function) => (
            function.r#async || function.generator,
            &function.params.items,
            function
                .body
                .as_ref()
                .map(|body| body.statements.as_slice()),
            None,
        ),
        AstKind::ArrowFunctionExpression(function) => (
            function.r#async,
            &function.params.items,
            function
                .body
                .as_function_body()
                .map(|body| body.statements.as_slice()),
            function.get_expression(),
        ),
        _ => return None,
    };
    if is_async_or_generator {
        return None;
    }
    let mut parameter_indices = DerivedStateEffectFxHashMap::default();
    for (parameter_index, parameter) in parameters.iter().enumerate() {
        parameter_indices.insert(
            parameter.pattern.get_binding_identifier()?.symbol_id(),
            parameter_index,
        );
    }
    let mut used_parameter_indices = DerivedStateEffectFxHashSet::default();
    let mut visited_symbol_ids = Vec::new();
    if let Some(expression) = expression {
        return derived_state_effect_foreign_expression_is_pure(
            expression,
            function_id,
            semantic,
            &parameter_indices,
            &mut used_parameter_indices,
            &mut visited_symbol_ids,
        )
        .then_some(used_parameter_indices);
    }
    let can_continue = derived_state_effect_foreign_statements_can_continue(
        statements?,
        function_id,
        semantic,
        &parameter_indices,
        &mut used_parameter_indices,
        &mut visited_symbol_ids,
    )?;
    (!can_continue).then_some(used_parameter_indices)
}

fn derived_state_effect_foreign_statements_can_continue(
    statements: &[DerivedStateEffectStatement<'_>],
    function_id: NodeId,
    semantic: &DerivedStateEffectSemantic<'_>,
    parameter_indices: &DerivedStateEffectFxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut DerivedStateEffectFxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<bool> {
    let mut can_continue = true;
    for statement in statements {
        if !can_continue {
            if !matches!(statement, DerivedStateEffectStatement::EmptyStatement(_)) {
                return None;
            }
            continue;
        }
        match statement {
            DerivedStateEffectStatement::EmptyStatement(_) => {}
            DerivedStateEffectStatement::VariableDeclaration(declaration)
                if declaration.kind.is_const() =>
            {
                for declarator in &declaration.declarations {
                    declarator.id.get_binding_identifier()?;
                    if !derived_state_effect_foreign_expression_is_pure(
                        declarator.init.as_ref()?,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    ) {
                        return None;
                    }
                }
            }
            DerivedStateEffectStatement::ReturnStatement(statement) => {
                if !derived_state_effect_foreign_expression_is_pure(
                    statement.argument.as_ref()?,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                ) {
                    return None;
                }
                can_continue = false;
            }
            DerivedStateEffectStatement::BlockStatement(block) => {
                can_continue = derived_state_effect_foreign_statements_can_continue(
                    &block.body,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                )?;
            }
            DerivedStateEffectStatement::IfStatement(statement) => {
                if !derived_state_effect_foreign_expression_is_pure(
                    &statement.test,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                ) {
                    return None;
                }
                let consequent_can_continue = derived_state_effect_foreign_statements_can_continue(
                    std::slice::from_ref(&statement.consequent),
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                )?;
                let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                    derived_state_effect_foreign_statements_can_continue(
                        std::slice::from_ref(alternate),
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )?
                } else {
                    true
                };
                can_continue = consequent_can_continue || alternate_can_continue;
            }
            _ => return None,
        }
    }
    Some(can_continue)
}

fn derived_state_effect_foreign_expression_is_pure(
    expression: &Expression<'_>,
    function_id: NodeId,
    semantic: &DerivedStateEffectSemantic<'_>,
    parameter_indices: &DerivedStateEffectFxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut DerivedStateEffectFxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in semantic.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(function)
                if candidate.id() != function_id && (function.r#async || function.generator) =>
            {
                return false;
            }
            AstKind::ArrowFunctionExpression(function)
                if candidate.id() != function_id && function.r#async =>
            {
                return false;
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(construction) => {
                let Expression::Identifier(identifier) = construction.callee.get_inner_expression()
                else {
                    return false;
                };
                if !matches!(identifier.name.as_str(), "Date" | "Set")
                    || semantic
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some()
                {
                    return false;
                }
            }
            AstKind::CallExpression(call)
                if !derived_state_effect_foreign_call_is_pure(call, semantic) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let Some(symbol_id) = semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                else {
                    if !derived_state_effect_identifier_name_is_allowed_global(
                        identifier.name.as_str(),
                    ) {
                        return false;
                    }
                    continue;
                };
                if let Some(parameter_index) = parameter_indices.get(&symbol_id) {
                    used_parameter_indices.insert(*parameter_index);
                    continue;
                }
                let declaration = semantic.symbol_declaration(symbol_id);
                if matches!(declaration.kind(), AstKind::FormalParameter(_))
                    && expression_span.contains_inclusive(declaration.span())
                {
                    continue;
                }
                if visited_symbol_ids.contains(&symbol_id) {
                    return false;
                }
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return false;
                };
                if !expression_span.contains_inclusive(declaration.span())
                    || !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                {
                    return false;
                }
                visited_symbol_ids.push(symbol_id);
                let is_pure = declarator.init.as_ref().is_some_and(|initializer| {
                    derived_state_effect_foreign_expression_is_pure(
                        initializer,
                        function_id,
                        semantic,
                        parameter_indices,
                        used_parameter_indices,
                        visited_symbol_ids,
                    )
                });
                visited_symbol_ids.pop();
                if !is_pure {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

fn derived_state_effect_foreign_call_is_pure(
    call: &oxc_ast::ast::CallExpression<'_>,
    semantic: &DerivedStateEffectSemantic<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            DERIVED_PURE_DIRECT_CALLS.contains(&identifier.name.as_str())
                && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                DERIVED_PURE_MEMBER_CALLS.contains(&property_name)
                    || derived_state_effect_foreign_is_pure_namespace_call(
                        member.object(),
                        property_name,
                        semantic,
                    )
                    || (property_name == "sort"
                        && derived_state_effect_is_fresh_array_copy(member.object()))
                    || (property_name == "getTime"
                        && matches!(member.object().get_inner_expression(), Expression::NewExpression(construction)
                            if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                                if identifier.name == "Date"
                                    && !construction.arguments.is_empty()
                                    && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())))
            })
        }),
    }
}

fn derived_state_effect_foreign_is_pure_namespace_call(
    object: &Expression<'_>,
    property_name: &str,
    semantic: &DerivedStateEffectSemantic<'_>,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
    if semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some()
    {
        return false;
    }
    derived_state_effect_pure_namespace_member_name(identifier.name.as_str(), property_name)
}

fn derived_is_pure_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if DERIVED_PURE_DIRECT_CALLS.contains(&identifier.name.as_str())
                && derived_identifier_is_global(identifier, ctx)
            {
                return true;
            }
            false
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                DERIVED_PURE_MEMBER_CALLS.contains(&property_name)
                    || derived_is_pure_namespace_member_call(member.object(), property_name, ctx)
                    || (property_name == "getTime"
                        && derived_state_effect_is_direct_date_value(member.object(), ctx))
            })
        }),
    }
}

fn derived_state_effect_local_helper_call_is_pure(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    derived_is_pure_call(call, ctx)
        || call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                member.static_property_name() == Some("sort")
                    && derived_state_effect_is_fresh_array_copy(member.object())
            })
}

fn derived_state_effect_is_fresh_array_copy(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::CallExpression(call) => call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .is_some_and(|name| DERIVED_STATE_EFFECT_FRESH_ARRAY_COPY_METHODS.contains(&name)),
        _ => false,
    }
}

fn derived_state_effect_is_direct_date_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::NewExpression(construction) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = construction.callee.get_inner_expression() else {
        return false;
    };
    !construction.arguments.is_empty()
        && identifier.name == "Date"
        && derived_identifier_is_global(identifier, ctx)
}

fn derived_is_pure_namespace_member_call(
    object: &Expression<'_>,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
    if !derived_identifier_is_global(identifier, ctx) {
        return false;
    }
    derived_state_effect_pure_namespace_member_name(identifier.name.as_str(), property_name)
}

fn derived_state_effect_pure_namespace_member_name(object_name: &str, property_name: &str) -> bool {
    match object_name {
        "Array" => property_name == "from",
        "JSON" => matches!(
            property_name,
            "isRawJSON" | "parse" | "rawJSON" | "stringify"
        ),
        "Math" => matches!(
            property_name,
            "abs"
                | "acos"
                | "acosh"
                | "asin"
                | "asinh"
                | "atan"
                | "atan2"
                | "atanh"
                | "cbrt"
                | "ceil"
                | "clz32"
                | "cos"
                | "cosh"
                | "exp"
                | "floor"
                | "fround"
                | "hypot"
                | "imul"
                | "log"
                | "log10"
                | "log1p"
                | "log2"
                | "max"
                | "min"
                | "pow"
                | "round"
                | "sign"
                | "sin"
                | "sinh"
                | "sqrt"
                | "tan"
                | "tanh"
                | "trunc"
        ),
        "Object" => property_name == "assign",
        _ => false,
    }
}

fn derived_identifier_is_global(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}
