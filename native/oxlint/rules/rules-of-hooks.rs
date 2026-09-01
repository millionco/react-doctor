use std::borrow::Cow;

use lazy_regex::Regex;
use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, BindingPattern, CallExpression, Expression, Function, PropertyKey,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{AstNodes, NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const REACT_ECOSYSTEM_PACKAGE_NAMES: [&str; 12] = [
    "next",
    "next-themes",
    "@remix-run/react",
    "swr",
    "zustand",
    "jotai",
    "recoil",
    "wouter",
    "framer-motion",
    "@apollo/client",
    "urql",
    "usehooks-ts",
];
const EFFECT_HOOK_NAMES: [&str; 4] = [
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useEffectEvent",
];

#[derive(Debug, Default, Clone)]
pub struct RulesOfHooks;

declare_oxc_lint!(
    /// Enforces stable Hook order and valid React render scopes.
    RulesOfHooks,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Hook called conditionally.",
);

impl Rule for RulesOfHooks {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && !ctx
                .file_extension()
                .is_some_and(|extension| extension == "vue" || extension == "svelte")
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        let react_use_effect_event_import_symbols = ctx
            .module_record()
            .import_entries
            .iter()
            .filter(|entry| {
                !entry.is_type
                    && REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                    && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported) if imported.name() == "useEffectEvent")
            })
            .filter_map(|entry| {
                ctx.scoping()
                    .get_root_binding(entry.local_name.name().into())
            })
            .collect::<FxHashSet<_>>();
        let additional_effect_hooks = additional_effect_hooks(ctx);
        let function_id_by_span = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(
                    node.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
                .then_some(((node.span().start, node.span().end), node.id()))
            })
            .collect::<FxHashMap<_, _>>();
        let mut hook_name_by_call = FxHashMap::<NodeId, &str>::default();
        let mut hook_calls_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut local_function_by_call = FxHashMap::<NodeId, NodeId>::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(hook_name) = recognized_hook_name(node, call, &property_write_analysis, ctx)
            else {
                continue;
            };
            hook_name_by_call.insert(node.id(), hook_name);
            if let Some(owner) = parent_function(ctx.nodes(), node) {
                hook_calls_by_function
                    .entry(owner.id())
                    .or_default()
                    .push(node.id());
                if let Some(function_id) =
                    local_function_id_for_call(call, &function_id_by_span, ctx)
                {
                    local_function_by_call.insert(node.id(), function_id);
                }
            }
        }
        let mut hook_counts = FxHashMap::<NodeId, usize>::default();
        for function_id in hook_calls_by_function.keys().copied() {
            let count = count_own_scope_hook_calls(
                function_id,
                &hook_calls_by_function,
                &local_function_by_call,
                &mut FxHashSet::default(),
            );
            hook_counts.insert(function_id, count);
        }
        let mut unconditional_by_cfg_pair = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let hook_name = hook_name_by_call.get(&node.id()).copied();
            let is_react_use_effect_event =
                is_react_use_effect_event_call(call, &react_use_effect_event_import_symbols, ctx);
            if hook_name.is_none() && !is_react_use_effect_event {
                continue;
            }
            let is_suppressed =
                is_rules_of_hooks_suppressed_at(call.callee.span().start, ctx.source_text());
            if is_react_use_effect_event {
                let did_report_non_initializer = check_use_effect_event_usage(
                    node,
                    call,
                    !is_suppressed && hook_name == Some("useEffectEvent"),
                    additional_effect_hooks.as_ref(),
                    ctx,
                );
                if did_report_non_initializer {
                    continue;
                }
            }
            let Some(hook_name) = hook_name else {
                continue;
            };
            if is_suppressed {
                continue;
            }
            if is_local_hook_free_function_call(call, &function_id_by_span, &hook_counts, ctx)
                || is_project_owned_mdx_getter(call, ctx)
            {
                continue;
            }
            check_hook_placement(
                node,
                call,
                hook_name,
                &hook_counts,
                &mut unconditional_by_cfg_pair,
                ctx,
            );
        }
    }
}

fn count_own_scope_hook_calls(
    function_id: NodeId,
    hook_calls_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    local_function_by_call: &FxHashMap<NodeId, NodeId>,
    counted_functions: &mut FxHashSet<NodeId>,
) -> usize {
    if !counted_functions.insert(function_id) {
        return 0;
    }
    hook_calls_by_function
        .get(&function_id)
        .into_iter()
        .flatten()
        .filter(|call_id| {
            local_function_by_call.get(call_id).is_none_or(|callee_id| {
                count_own_scope_hook_calls(
                    *callee_id,
                    hook_calls_by_function,
                    local_function_by_call,
                    counted_functions,
                ) > 0
            })
        })
        .count()
}

fn check_hook_placement<'a>(
    node: &AstNode<'a>,
    call: &CallExpression<'a>,
    hook_name: &str,
    hook_counts: &FxHashMap<NodeId, usize>,
    unconditional_by_cfg_pair: &mut FxHashMap<(oxc_cfg::BlockNodeId, oxc_cfg::BlockNodeId), bool>,
    ctx: &LintContext<'a>,
) {
    let hook_span = call.callee.span();
    let Some(parent_function_node) = parent_function(ctx.nodes(), node) else {
        if !is_package_imported_non_react_hook(call, ctx) {
            report(ctx, hook_span, top_level_message(hook_name));
        }
        return;
    };

    if is_inside_class(ctx.nodes(), node.id(), parent_function_node.id()) {
        if !is_package_imported_non_react_hook(call, ctx)
            && !is_default_imported_class_api_member(call, ctx)
        {
            report(ctx, hook_span, class_message(hook_name));
        }
        return;
    }

    let parent_info = function_info(parent_function_node, ctx);
    if parent_info.is_async {
        report(ctx, hook_span, async_message(hook_name));
        return;
    }

    let is_likely_render_scope = !parent_info.is_component_or_hook
        && parent_info.has_resolved_name
        && is_render_scope_factory_name(parent_info.name.as_ref())
        && enclosing_component_or_hook(parent_function_node, ctx).is_none()
        && hook_counts
            .get(&parent_function_node.id())
            .copied()
            .unwrap_or(0)
            >= 2;

    if hook_name == "use" {
        let mut is_inside_render_scope = parent_info.is_component_or_hook || is_likely_render_scope;
        let mut outer_function = parent_function_node;
        while !is_inside_render_scope {
            let Some(next_function) = parent_function(ctx.nodes(), outer_function) else {
                break;
            };
            outer_function = next_function;
            is_inside_render_scope = function_info(outer_function, ctx).is_component_or_hook;
        }
        if !is_inside_render_scope {
            if parent_info.has_resolved_name && !is_package_imported_non_react_hook(call, ctx) {
                report(
                    ctx,
                    hook_span,
                    non_component_message(hook_name, parent_info.name.as_ref()),
                );
            }
        } else if is_inside_try(ctx.nodes(), node.id(), parent_function_node.id()) {
            report(ctx, hook_span, try_message(hook_name));
        }
        return;
    }

    if !parent_info.is_component_or_hook && !is_likely_render_scope {
        if !parent_info.has_resolved_name {
            if enclosing_component_or_hook(parent_function_node, ctx).is_some() {
                report(ctx, hook_span, conditional_message(hook_name));
            }
            return;
        }
        if !is_package_imported_non_react_hook(call, ctx) {
            report(
                ctx,
                hook_span,
                non_component_message(hook_name, parent_info.name.as_ref()),
            );
        }
        return;
    }

    if is_inside_loop(ctx.nodes(), node.id(), parent_function_node.id())
        || ctx.cfg().is_cyclic(ctx.nodes().cfg_id(node.id()))
    {
        report(ctx, hook_span, loop_message(hook_name));
        return;
    }
    if is_inside_try(ctx.nodes(), node.id(), parent_function_node.id()) {
        report(ctx, hook_span, try_message(hook_name));
        return;
    }
    if is_node_conditionally_executed(node, parent_function_node.id(), ctx)
        || !rules_of_hooks_is_unconditional_from_entry(
            node,
            parent_function_node,
            unconditional_by_cfg_pair,
            ctx,
        )
    {
        if !is_after_only_invariant_react_hook_capability_exits(node, parent_function_node, ctx) {
            report(ctx, hook_span, conditional_message(hook_name));
        }
    }
}

fn rules_of_hooks_is_unconditional_from_entry<'a>(
    node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    unconditional_by_cfg_pair: &mut FxHashMap<(oxc_cfg::BlockNodeId, oxc_cfg::BlockNodeId), bool>,
    ctx: &LintContext<'a>,
) -> bool {
    let entry_block = ctx.nodes().cfg_id(function_node.id());
    let target_block = ctx.nodes().cfg_id(node.id());
    if let Some(is_unconditional) = unconditional_by_cfg_pair.get(&(entry_block, target_block)) {
        return *is_unconditional;
    }
    let reachable_blocks = rules_of_hooks_reachable_cfg_blocks(entry_block, None, ctx);
    let is_unconditional = !reachable_blocks.contains(&target_block)
        || !rules_of_hooks_reachable_cfg_blocks(entry_block, Some(target_block), ctx)
            .into_iter()
            .any(|block_id| {
                ctx.cfg()
                    .basic_block(block_id)
                    .instructions()
                    .iter()
                    .any(|instruction| {
                        matches!(
                            instruction.kind,
                            oxc_cfg::InstructionKind::ImplicitReturn
                                | oxc_cfg::InstructionKind::Return(_)
                        )
                    })
            });
    unconditional_by_cfg_pair.insert((entry_block, target_block), is_unconditional);
    is_unconditional
}

fn rules_of_hooks_reachable_cfg_blocks(
    entry_block: oxc_cfg::BlockNodeId,
    excluded_block: Option<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_cfg::BlockNodeId> {
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = Vec::new();
    if Some(entry_block) != excluded_block {
        pending_blocks.push(entry_block);
    }
    while let Some(block_id) = pending_blocks.pop() {
        if !visited_blocks.insert(block_id) {
            continue;
        }
        for edge in ctx
            .cfg()
            .graph()
            .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
        {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if Some(target) != excluded_block {
                pending_blocks.push(target);
            }
        }
    }
    visited_blocks
}

fn is_after_only_invariant_react_hook_capability_exits<'a>(
    hook_node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(hook_node.id()) {
        if ancestor.id() == function_node.id()
            || matches!(ancestor.kind(), AstKind::FunctionBody(_))
        {
            break;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::SwitchStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    let statements = match function_node.kind() {
        AstKind::Function(function) => {
            let Some(body) = &function.body else {
                return false;
            };
            &body.statements
        }
        AstKind::ArrowFunctionExpression(function) if function.get_expression().is_none() => {
            &function.get_function_body().unwrap().statements
        }
        _ => return false,
    };
    let statement_index = statements
        .iter()
        .position(|statement| statement.span().contains_inclusive(hook_node.span()));
    let Some(statement_index) = statement_index.filter(|index| *index > 0) else {
        return false;
    };
    let bypassing_statements = statements[..statement_index]
        .iter()
        .filter(|statement| statement_contains_abrupt_completion(statement, function_node, ctx))
        .collect::<Vec<_>>();
    !bypassing_statements.is_empty()
        && bypassing_statements
            .iter()
            .all(|statement| is_invariant_react_hook_capability_exit(statement, ctx))
}

fn statement_contains_abrupt_completion<'a>(
    statement: &Statement<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        statement.span().contains_inclusive(candidate.span())
            && matches!(
                candidate.kind(),
                AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
            )
            && parent_function(ctx.nodes(), candidate)
                .is_some_and(|owner| owner.id() == function_node.id())
    })
}

fn is_invariant_react_hook_capability_exit<'a>(
    statement: &Statement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Statement::IfStatement(statement) = statement else {
        return false;
    };
    statement.alternate.is_none()
        && statement_always_exits(&statement.consequent)
        && is_invariant_react_hook_capability_condition(&statement.test, ctx)
}

fn is_invariant_react_hook_capability_condition<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_react_hook_capability_value(expression, &mut FxHashSet::default(), ctx) {
        return true;
    }
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
    {
        return is_invariant_react_hook_capability_condition(&unary.argument, ctx);
    }
    if let Expression::LogicalExpression(logical) = expression {
        return is_invariant_react_hook_capability_condition(&logical.left, ctx)
            && is_invariant_react_hook_capability_condition(&logical.right, ctx);
    }
    let Expression::BinaryExpression(binary) = expression else {
        return false;
    };
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) {
        return false;
    }
    (is_react_hook_capability_operand(&binary.left, ctx)
        && is_static_capability_comparison_value(&binary.right, ctx))
        || (is_react_hook_capability_operand(&binary.right, ctx)
            && is_static_capability_comparison_value(&binary.left, ctx))
}

fn is_react_hook_capability_operand<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    is_react_hook_capability_value(expression, &mut FxHashSet::default(), ctx)
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Typeof && is_react_hook_capability_value(&unary.argument, &mut FxHashSet::default(), ctx))
}

fn is_static_capability_comparison_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        _ => false,
    }
}

fn is_react_hook_capability_value<'a>(
    expression: &Expression<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if let Some(entry) = resolve_identifier_import(identifier, ctx) {
            return entry.module_request.name() == "react"
                && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported) if crate::utils::is_react_hook_name(imported.name()));
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let AstKind::VariableDeclaration(variable_declaration) =
            ctx.nodes().parent_kind(declaration.id())
        else {
            return false;
        };
        if !variable_declaration.kind.is_const() {
            return false;
        }
        if let Some(property_name) = binding_property_name_for_symbol(&declarator.id, symbol_id)
            && crate::utils::is_react_hook_name(&property_name)
            && let Some(Expression::Identifier(namespace)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            && is_react_namespace_import(namespace, ctx)
            && !has_possible_static_property_mutation_or_escape(namespace, &property_name, ctx)
        {
            return true;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        return declarator.init.as_ref().is_some_and(|initializer| {
            is_react_hook_capability_value(initializer, visited_symbols, ctx)
        });
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    crate::utils::is_react_hook_name(property_name.as_ref())
        && matches!(member.object().get_inner_expression(), Expression::Identifier(namespace) if is_react_namespace_import(namespace, ctx) && !has_possible_static_property_mutation_or_escape(namespace, property_name.as_ref(), ctx))
}

fn is_react_namespace_import<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
        entry.module_request.name() == "react"
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
                    | crate::module_record::ImportImportName::Default(_)
            )
    })
}

fn has_possible_static_property_mutation_or_escape<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if let Some(member_node) = static_property_write_member(reference_node, ctx)
                && resolved_static_member_property_name(member_node, ctx)
                    .as_deref()
                    .is_none_or(|written_property_name| written_property_name == property_name)
            {
                return true;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let is_destructuring_alias_source = matches!(
                parent.kind(),
                AstKind::VariableDeclarator(declarator)
                    if declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == reference_root.span())
                        && matches!(declarator.id, oxc_ast::ast::BindingPattern::ObjectPattern(_))
            );
            let is_member_object = match parent.kind() {
                AstKind::StaticMemberExpression(member) => {
                    member.object.span() == reference_root.span()
                }
                AstKind::ComputedMemberExpression(member) => {
                    member.object.span() == reference_root.span()
                }
                _ => false,
            };
            direct_alias_target_symbol_id(reference_node, ctx).is_none()
                && !is_destructuring_alias_source
                && !is_member_object
        })
}

fn recognized_hook_name<'a, 'b>(
    call_node: &AstNode<'a>,
    call: &'b CallExpression<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'b str> {
    if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
        let name = identifier.name.as_str();
        if !crate::utils::is_react_hook_name(name) || is_parameter_binding(identifier, ctx) {
            return None;
        }
        if name == "use"
            && let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        {
            if !is_react_use_binding(identifier, symbol_id, &mut FxHashSet::default(), ctx) {
                return None;
            }
        }
        return Some(name);
    }

    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return None;
    };
    let property_name = member.property.name.as_str();
    if !crate::utils::is_react_hook_name(property_name) {
        return None;
    }
    let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
        return None;
    };
    if !receiver
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
        || allowed_pascal_case_hook_namespaces(ctx).any(|name| name == receiver.name.as_str())
        || is_package_imported_non_react_member(
            receiver,
            property_name,
            call_node,
            property_write_analysis,
            ctx,
        )
    {
        return None;
    }
    if property_name == "use"
        && receiver.name != "React"
        && call.arguments.first().is_some_and(|argument| {
            matches!(
                argument.as_expression(),
                Some(Expression::ArrayExpression(_))
            )
        })
    {
        return None;
    }
    Some(property_name)
}

fn is_react_use_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: SymbolId,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    if let Some(entry) = resolve_identifier_import(identifier, ctx) {
        return entry.module_request.name() == "react"
            && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported) if imported.name() == "use");
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("use")
        && let Expression::Identifier(namespace) = initializer.get_inner_expression()
        && resolve_identifier_import(namespace, ctx).is_some_and(|entry| {
            entry.module_request.name() == "react"
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::NamespaceObject
                        | crate::module_record::ImportImportName::Default(_)
                )
        })
    {
        return true;
    }
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("use")
        && is_require_react_call(initializer.get_inner_expression())
    {
        return true;
    }
    if matches!(initializer.get_inner_expression(), Expression::StaticMemberExpression(member)
        if member.property.name == "use"
            && matches!(member.object.get_inner_expression(), Expression::Identifier(receiver) if receiver.name == "React"))
    {
        return true;
    }
    if matches!(initializer.get_inner_expression(), Expression::StaticMemberExpression(member) if member.property.name == "use" && is_require_react_call(member.object.get_inner_expression()))
    {
        return true;
    }
    let Expression::Identifier(alias) = initializer.get_inner_expression() else {
        return false;
    };
    let Some(alias_symbol_id) = ctx
        .scoping()
        .get_reference(alias.reference_id())
        .symbol_id()
    else {
        return false;
    };
    is_react_use_binding(alias, alias_symbol_id, visited_symbols, ctx)
}

fn is_require_react_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "require")
        && matches!(call.arguments.first().and_then(|argument| argument.as_expression()).map(Expression::get_inner_expression), Some(Expression::StringLiteral(source)) if source.value == "react")
}

fn is_parameter_binding(
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
    matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::FormalParameter(_) | AstKind::CatchParameter(_)
    )
}

fn allowed_pascal_case_hook_namespaces<'a>(
    ctx: &'a LintContext<'_>,
) -> impl Iterator<Item = &'a str> {
    let settings = ctx.settings().json.as_ref();
    let react_doctor_namespaces = settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("rulesOfHooks"))
        .and_then(|settings| settings.get("allowedPascalCaseHookNamespaces"))
        .and_then(serde_json::Value::as_array);
    let react_hooks_namespaces = settings
        .and_then(|settings| settings.get("react-hooks"))
        .and_then(|settings| settings.get("allowedPascalCaseHookNamespaces"))
        .and_then(serde_json::Value::as_array);
    react_doctor_namespaces
        .or(react_hooks_namespaces)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
}

fn function_info<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> FunctionInfo<'b> {
    let resolved_name = infer_function_name(function_node, ctx);
    FunctionInfo {
        name: resolved_name
            .clone()
            .unwrap_or_else(|| Cow::Borrowed("anonymous")),
        has_resolved_name: resolved_name.is_some(),
        is_async: match function_node.kind() {
            AstKind::Function(function) => function.r#async,
            AstKind::ArrowFunctionExpression(function) => function.r#async,
            _ => false,
        },
        is_component_or_hook: is_react_hoc_callback(function_node, ctx)
            || resolved_name.is_some_and(|name| {
                crate::utils::is_react_component_or_hook_name(name.as_ref())
                    || (is_underscore_component_name(name.as_ref())
                        && !matches!(
                            ctx.nodes().parent_kind(function_node.id()),
                            AstKind::CallExpression(_)
                        ))
            }),
    }
}

struct FunctionInfo<'a> {
    name: Cow<'a, str>,
    has_resolved_name: bool,
    is_async: bool,
    is_component_or_hook: bool,
}

fn infer_function_name<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<Cow<'b, str>> {
    if let AstKind::Function(Function {
        id: Some(identifier),
        ..
    }) = function_node.kind()
    {
        return Some(Cow::Borrowed(identifier.name.as_str()));
    }
    let mut expression_root = function_node;
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            break;
        };
        if !is_react_hoc_call(call) {
            break;
        }
        expression_root = parent;
    }
    loop {
        expression_root = transparent_expression_root(expression_root, ctx);
        let parent = ctx.nodes().parent_node(expression_root.id());
        if matches!(parent.kind(), AstKind::AssignmentPattern(_)) {
            expression_root = parent;
            continue;
        }
        break;
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declaration) => match &declaration.id {
            BindingPattern::BindingIdentifier(identifier) => {
                Some(Cow::Borrowed(identifier.name.as_str()))
            }
            _ => None,
        },
        AstKind::AssignmentExpression(assignment) => match &assignment.left {
            AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                Some(Cow::Borrowed(identifier.name.as_str()))
            }
            _ => None,
        },
        AstKind::ObjectProperty(property) if !property.computed => match &property.key {
            PropertyKey::StaticIdentifier(identifier) => {
                Some(Cow::Borrowed(identifier.name.as_str()))
            }
            _ => None,
        },
        _ => None,
    }
}

fn is_react_hoc_callback(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments.first().is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) && is_react_hoc_call(call)
}

fn is_react_hoc_call(call: &CallExpression<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "memo" | "forwardRef")
        }
        Expression::StaticMemberExpression(member) => {
            matches!(member.property.name.as_str(), "memo" | "forwardRef")
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    }
}

fn parent_function<'a, 'b>(nodes: &'b AstNodes<'a>, node: &AstNode<'a>) -> Option<&'b AstNode<'a>> {
    nodes.ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}

fn enclosing_component_or_hook<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let mut current = node;
    while let Some(function) = parent_function(ctx.nodes(), current) {
        if function_info(function, ctx).is_component_or_hook {
            return Some(function);
        }
        current = function;
    }
    None
}

fn is_inside_class(nodes: &AstNodes<'_>, hook_node_id: NodeId, function_node_id: NodeId) -> bool {
    nodes
        .ancestors(hook_node_id)
        .take_while(|ancestor| ancestor.id() != function_node_id)
        .any(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
        || matches!(
            nodes.parent_kind(function_node_id),
            AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_) | AstKind::StaticBlock(_)
        )
}

fn is_inside_try(nodes: &AstNodes<'_>, node_id: NodeId, function_node_id: NodeId) -> bool {
    nodes
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != function_node_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::TryStatement(_) | AstKind::CatchClause(_)
            )
        })
}

fn is_inside_loop(nodes: &AstNodes<'_>, node_id: NodeId, function_node_id: NodeId) -> bool {
    nodes
        .ancestors(node_id)
        .take_while(|ancestor| ancestor.id() != function_node_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::DoWhileStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
            )
        })
}

fn is_underscore_component_name(name: &str) -> bool {
    let without_underscores = name.trim_start_matches('_');
    without_underscores.len() != name.len()
        && without_underscores
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
}

fn is_render_scope_factory_name(name: &str) -> bool {
    let name = name.strip_prefix('_').unwrap_or(name);
    ["init", "create", "make", "build"].iter().any(|prefix| {
        name.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.is_empty()
                || suffix.as_bytes().first().is_some_and(|byte| {
                    byte.is_ascii_uppercase() || byte.is_ascii_digit() || *byte == b'_'
                })
        })
    })
}

fn is_local_hook_free_function_call(
    call: &CallExpression<'_>,
    function_id_by_span: &FxHashMap<(u32, u32), NodeId>,
    hook_counts: &FxHashMap<NodeId, usize>,
    ctx: &LintContext<'_>,
) -> bool {
    local_function_id_for_call(call, function_id_by_span, ctx)
        .is_some_and(|function_id| hook_counts.get(&function_id).copied().unwrap_or(0) == 0)
}

fn local_function_id_for_call(
    call: &CallExpression<'_>,
    function_id_by_span: &FxHashMap<(u32, u32), NodeId>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = match declaration.kind() {
        AstKind::Function(_) => Some(declaration),
        AstKind::VariableDeclarator(_) => {
            resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).and_then(|initializer| {
                let initializer_span = initializer.span();
                function_id_by_span
                    .get(&(initializer_span.start, initializer_span.end))
                    .map(|node_id| ctx.nodes().get_node(*node_id))
            })
        }
        _ => None,
    };
    function_node.map(AstNode::id)
}

fn is_package_imported_non_react_hook(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    import_for_local_name(identifier.name.as_str(), ctx)
        .is_some_and(|entry| is_non_react_package_source(entry.module_request.name()))
}

fn is_package_imported_non_react_member<'a>(
    receiver: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    call_node: &AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| symbol_has_write_before(symbol_id, receiver.span.start, ctx))
    {
        return false;
    }
    if has_possible_static_property_write_before(
        receiver,
        property_name,
        call_node,
        property_write_analysis,
        ctx,
    ) {
        return false;
    }
    resolve_identifier_import(receiver, ctx)
        .is_some_and(|entry| is_non_react_package_source(entry.module_request.name()))
}

fn is_non_react_package_source(source: &str) -> bool {
    !source.starts_with('.')
        && !source.starts_with("@/")
        && !source.starts_with("~/")
        && !REACT_RUNTIME_MODULE_SOURCES.contains(&source)
        && !source.to_ascii_lowercase().contains("react")
        && !REACT_ECOSYSTEM_PACKAGE_NAMES.contains(&package_name(source))
}

fn package_name(source: &str) -> &str {
    if source.starts_with('@') {
        source
            .match_indices('/')
            .nth(1)
            .map_or(source, |(index, _)| &source[..index])
    } else {
        source.split('/').next().unwrap_or(source)
    }
}

fn is_default_imported_class_api_member(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object() else {
        return false;
    };
    if receiver.name.ends_with("Hook") || receiver.name.ends_with("Hooks") {
        return false;
    }
    import_for_local_name(receiver.name.as_str(), ctx).is_some_and(|entry| {
        matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Default(_)
        ) && !REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
    })
}

fn is_project_owned_mdx_getter(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    identifier.name == "useMDXComponents"
        && import_for_local_name(identifier.name.as_str(), ctx).is_some_and(|entry| {
            let source = entry.module_request.name();
            source.starts_with('.') || source.starts_with("@/") || source.starts_with("~/")
        })
}

fn import_for_local_name<'a, 'b>(
    local_name: &str,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    ctx.module_record()
        .import_entries
        .iter()
        .find(|entry| entry.local_name.name() == local_name)
}

fn is_react_use_effect_event_call<'a>(
    call: &CallExpression<'a>,
    react_use_effect_event_import_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            symbol_id.map_or(identifier.name == "useEffectEvent", |symbol_id| {
                react_use_effect_event_import_symbols.contains(&symbol_id)
            })
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("useEffectEvent") {
                return false;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            resolve_identifier_import(receiver, ctx).is_some_and(|entry| {
                REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                    && matches!(
                        &entry.import_name,
                        crate::module_record::ImportImportName::NamespaceObject
                            | crate::module_record::ImportImportName::Default(_)
                    )
            }) || (receiver.name == "React"
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none())
        }
    }
}

fn check_use_effect_event_usage(
    node: &AstNode<'_>,
    call: &CallExpression<'_>,
    should_report_non_initializer: bool,
    additional_effect_hooks: Option<&Regex>,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().parent_kind(node.id()) {
        AstKind::VariableDeclarator(declaration)
            if declaration
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == call.span) =>
        {
            let Some(identifier) = declaration.id.get_binding_identifier() else {
                return false;
            };
            report_invalid_effect_event_references(
                identifier.symbol_id(),
                additional_effect_hooks,
                ctx,
            );
            false
        }
        _ if should_report_non_initializer => {
            report(ctx, call.callee.span(), effect_event_passed_down_message());
            true
        }
        _ => false,
    }
}

fn report_invalid_effect_event_references(
    symbol_id: SymbolId,
    additional_effect_hooks: Option<&Regex>,
    ctx: &LintContext<'_>,
) {
    let declaration_component =
        enclosing_component_or_hook(ctx.symbol_declaration(symbol_id), ctx).map(|node| node.id());
    for reference in ctx.semantic().symbol_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if enclosing_component_or_hook(reference_node, ctx).map(|node| node.id())
            != declaration_component
            || is_inside_allowed_effect_event_callback(reference_node, additional_effect_hooks, ctx)
        {
            continue;
        }
        let span = ctx.semantic().reference_span(reference);
        if is_rules_of_hooks_suppressed_at(span.start, ctx.source_text()) {
            continue;
        }
        let name = ctx.semantic().reference_name(reference);
        report(
            ctx,
            span,
            if is_reference_call_callee(reference_node, span, ctx) {
                effect_event_call_message(name)
            } else {
                effect_event_assignment_message(name)
            },
        );
    }
}

fn is_inside_allowed_effect_event_callback(
    node: &AstNode<'_>,
    additional_effect_hooks: Option<&Regex>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let AstKind::CallExpression(call) = ctx.nodes().parent_kind(ancestor.id()) else {
            return false;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == ancestor.span())
        }) {
            return false;
        }
        let Some(name) = call.callee_name() else {
            return false;
        };
        EFFECT_HOOK_NAMES.contains(&name)
            || additional_effect_hooks.is_some_and(|regex| regex.is_match(name))
    })
}

fn additional_effect_hooks(ctx: &LintContext<'_>) -> Option<Regex> {
    let settings = ctx.settings().json.as_ref();
    let pattern = settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("rulesOfHooks"))
        .and_then(|settings| settings.get("additionalEffectHooks"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            settings
                .and_then(|settings| settings.get("react-hooks"))
                .and_then(|settings| settings.get("additionalEffectHooks"))
                .and_then(serde_json::Value::as_str)
        })?;
    Regex::new(pattern).ok()
}

fn is_reference_call_callee<'a>(node: &AstNode<'a>, span: Span, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    matches!(ctx.nodes().parent_kind(root.id()), AstKind::CallExpression(call) if call.callee.span() == span)
}

fn is_rules_of_hooks_suppressed_at(offset: u32, source: &str) -> bool {
    let line_start = source[..offset as usize]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let line_end = source[offset as usize..]
        .find('\n')
        .map_or(source.len(), |index| offset as usize + index);
    if disable_directive_names_rule(&source[line_start..line_end], "disable-line") {
        return true;
    }
    if line_start == 0 {
        return false;
    }
    let previous_line_end = line_start - 1;
    let previous_line_start = source[..previous_line_end]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    disable_directive_names_rule(
        &source[previous_line_start..previous_line_end],
        "disable-next-line",
    )
}

fn disable_directive_names_rule(line: &str, directive: &str) -> bool {
    let Some(directive_index) = line
        .find(&format!("eslint-{directive}"))
        .or_else(|| line.find(&format!("oxlint-{directive}")))
    else {
        return false;
    };
    line[directive_index + directive.len() + "eslint-".len()..]
        .split(|character: char| character.is_whitespace() || character == ',')
        .map(|part| part.trim_matches(|character: char| matches!(character, ':' | ';')))
        .any(|part| matches!(part, "rules-of-hooks" | "react-hooks/rules-of-hooks"))
}

fn report(ctx: &LintContext<'_>, span: Span, message: String) {
    ctx.diagnostic(OxcDiagnostic::error(message).with_label(span));
}

fn top_level_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` can only run inside a React component or custom Hook because React needs that render scope to track Hook state."
    )
}

fn non_component_message(hook_name: &str, function_name: &str) -> String {
    format!(
        "`{hook_name}` runs inside `{function_name}`, which is not a component or Hook, so React cannot attach Hook state to a render."
    )
}

fn conditional_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook."
    )
}

fn loop_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` can run a different number of times inside a loop, so React can attach state to the wrong Hook."
    )
}

fn async_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` runs inside an async function, so React cannot guarantee the same Hook order during render."
    )
}

fn class_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` cannot run in a class component because Hooks require a function component or custom Hook render scope."
    )
}

fn try_message(hook_name: &str) -> String {
    format!(
        "`{hook_name}` can be skipped by try/catch/finally control flow, so React can attach state to the wrong Hook."
    )
}

fn effect_event_call_message(binding_name: &str) -> String {
    format!(
        "`{binding_name}` comes from useEffectEvent, so it only works when called from Effects in the same component."
    )
}

fn effect_event_assignment_message(binding_name: &str) -> String {
    format!(
        "{} It also breaks if saved in a variable or passed around.",
        effect_event_call_message(binding_name)
    )
}

fn effect_event_passed_down_message() -> String {
    "A function from useEffectEvent only works inside Effects in the same component, so passing it around breaks the event/dependency split.".to_string()
}
