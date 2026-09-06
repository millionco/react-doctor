use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, MethodDefinitionKind, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::LogicalOperator;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This MobX reaction discards its disposer and can outlive its owner. Store and dispose it during teardown.";
const MESSAGE_WITH_ABORT_SIGNAL: &str = "This MobX reaction discards its disposer and can outlive its owner. Store and dispose it during teardown. MobX 6.10+ can also bind its lifetime to an AbortSignal.";
const MOBX_MODULES: [&str; 1] = ["mobx"];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

#[derive(Debug, Default, Clone)]
pub struct MobxReactionDisposerDiscarded;

declare_oxc_lint!(
    /// Require discarded MobX reactions to have process lifetime or explicit teardown.
    MobxReactionDisposerDiscarded,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Discarded MobX reaction disposer.",
);

impl Rule for MobxReactionDisposerDiscarded {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "mobx:4") {
            return;
        }
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let subscription_name = ["reaction", "autorun"].into_iter().find(|api_name| {
                module_api_reference_matches(
                    &call_expression.callee,
                    api_name,
                    &MOBX_MODULES,
                    &property_write_analysis,
                    ctx,
                )
            });
            let Some(subscription_name) = subscription_name else {
                continue;
            };
            if !mobx_disposer_result_is_discarded(node, &property_write_analysis, ctx)
                || mobx_is_evaluated_at_module_scope(node, ctx)
                || mobx_is_process_lifetime_wiring(node, ctx)
                || mobx_callback_disposes_reaction(call_expression, subscription_name, ctx)
                || mobx_observes_only_instance_rooted_state(call_expression, ctx)
            {
                continue;
            }
            let supports_abort_signal = has_capability(ctx, "mobx:6.10");
            let options_index = if subscription_name == "autorun" { 1 } else { 2 };
            if supports_abort_signal
                && call_expression
                    .arguments
                    .get(options_index)
                    .and_then(Argument::as_expression)
                    .is_some_and(|options| {
                        mobx_options_may_carry_abort_signal(
                            options,
                            node,
                            &property_write_analysis,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
            {
                continue;
            }
            let message = if supports_abort_signal {
                MESSAGE_WITH_ABORT_SIGNAL
            } else {
                MESSAGE
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call_expression.span));
        }
    }
}

fn mobx_disposer_result_is_discarded(
    call_node: &AstNode<'_>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = call_node;
    loop {
        let parent = ctx.nodes().parent_node(child.id());
        match parent.kind() {
            AstKind::ExpressionStatement(_)
            | AstKind::UnaryExpression(_)
            | AstKind::BinaryExpression(_) => return true,
            AstKind::IfStatement(statement) if statement.test.span() == child.span() => {
                return true;
            }
            AstKind::WhileStatement(statement) if statement.test.span() == child.span() => {
                return true;
            }
            AstKind::DoWhileStatement(statement) if statement.test.span() == child.span() => {
                return true;
            }
            AstKind::ForStatement(statement)
                if statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span() == child.span()) =>
            {
                return true;
            }
            AstKind::SwitchStatement(statement)
                if statement.discriminant.span() == child.span() =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.test.span() == child.span() =>
            {
                return true;
            }
            AstKind::LogicalExpression(expression) if expression.left.span() == child.span() => {
                if expression.operator == LogicalOperator::And {
                    return true;
                }
                child = parent;
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child.span() => {
                child = parent;
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == child.span()
                    || expression.alternate.span() == child.span() =>
            {
                child = parent;
            }
            AstKind::SequenceExpression(expression) => {
                if expression
                    .expressions
                    .last()
                    .is_none_or(|last_expression| last_expression.span() != child.span())
                {
                    return true;
                }
                child = parent;
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_) => child = parent,
            AstKind::ArrowFunctionExpression(arrow_function)
                if arrow_function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == child.span()) =>
            {
                if mobx_arrow_is_react_effect_cleanup(parent, property_write_analysis, ctx) {
                    return false;
                }
                let arrow_root = transparent_expression_root(parent, ctx);
                let callback_call = ctx.nodes().parent_node(arrow_root.id());
                let AstKind::CallExpression(callback_call_expression) = callback_call.kind() else {
                    return false;
                };
                let is_for_each = callback_call_expression
                    .callee
                    .as_member_expression()
                    .is_some_and(|member| member.static_property_name() == Some("forEach"));
                if is_for_each {
                    return true;
                }
                child = callback_call;
            }
            AstKind::CallExpression(call_expression)
                if call_expression
                    .arguments
                    .iter()
                    .filter_map(Argument::as_expression)
                    .any(|argument| argument.span() == child.span()) =>
            {
                let Expression::Identifier(callee) = call_expression.callee.get_inner_expression()
                else {
                    return false;
                };
                return matches!(callee.name.as_str(), "Boolean" | "Number" | "String");
            }
            _ => return false,
        }
    }
}

fn mobx_arrow_is_react_effect_cleanup<'a, 'b>(
    arrow_node: &'b AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &'b LintContext<'a>,
) -> bool {
    let arrow_root = transparent_expression_root(arrow_node, ctx);
    let effect_node = ctx.nodes().parent_node(arrow_root.id());
    let AstKind::CallExpression(effect_call) = effect_node.kind() else {
        return false;
    };
    if effect_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_none_or(|callback| callback.span() != arrow_root.span())
    {
        return false;
    }
    ["useEffect", "useInsertionEffect", "useLayoutEffect"]
        .into_iter()
        .any(|api_name| {
            module_api_reference_matches(
                &effect_call.callee,
                api_name,
                &REACT_RUNTIME_MODULES,
                property_write_analysis,
                ctx,
            )
        })
}

fn mobx_is_process_lifetime_wiring(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::Function(function) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                if let AstKind::MethodDefinition(method) = parent.kind()
                    && method.kind == MethodDefinitionKind::Constructor
                {
                    return mobx_constructor_has_process_lifetime(parent, ctx);
                }
                let Some((function_name, symbol_id)) = mobx_function_name_and_symbol(
                    ancestor,
                    function
                        .id
                        .as_ref()
                        .map(|identifier| identifier.symbol_id()),
                    ctx,
                ) else {
                    return false;
                };
                return mobx_process_lifetime_function_name(function_name)
                    && mobx_symbol_is_module_scoped(symbol_id, ctx)
                    && mobx_all_direct_calls_are_module_scoped(symbol_id, ctx);
            }
            AstKind::ArrowFunctionExpression(_) => {
                let Some((function_name, symbol_id)) =
                    mobx_function_name_and_symbol(ancestor, None, ctx)
                else {
                    return false;
                };
                return mobx_process_lifetime_function_name(function_name)
                    && mobx_symbol_is_module_scoped(symbol_id, ctx)
                    && mobx_all_direct_calls_are_module_scoped(symbol_id, ctx);
            }
            _ => {}
        }
    }
    false
}

fn mobx_is_evaluated_at_module_scope(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut ancestor = ctx.nodes().parent_node(node.id());
    loop {
        match ancestor.kind() {
            AstKind::PropertyDefinition(property) if !property.r#static => return false,
            AstKind::AccessorProperty(property) if !property.r#static => return false,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                let function_root = transparent_expression_root(ancestor, ctx);
                let invocation = ctx.nodes().parent_node(function_root.id());
                if !matches!(invocation.kind(), AstKind::CallExpression(call) if call.callee.span().contains_inclusive(function_root.span()))
                {
                    return false;
                }
                ancestor = ctx.nodes().parent_node(invocation.id());
                continue;
            }
            AstKind::Program(_) => return true,
            _ => ancestor = ctx.nodes().parent_node(ancestor.id()),
        }
    }
}

fn mobx_function_name_and_symbol<'a>(
    function_node: &AstNode<'a>,
    declared_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'a>,
) -> Option<(&'a str, SymbolId)> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
        && let Some(symbol_id) = declared_symbol_id
    {
        return Some((identifier.name.as_str(), symbol_id));
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    let binding = declarator.id.get_binding_identifier()?;
    Some((binding.name.as_str(), binding.symbol_id()))
}

fn mobx_process_lifetime_function_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    let has_lifetime_subject = |suffix: &str| {
        [
            "store",
            "stores",
            "reaction",
            "reactions",
            "autorun",
            "autoruns",
        ]
        .into_iter()
        .any(|subject| suffix.ends_with(subject))
    };
    ["register", "init", "setup"].into_iter().any(|prefix| {
        lowercase_name
            .strip_prefix(prefix)
            .is_some_and(has_lifetime_subject)
    }) || lowercase_name
        .strip_prefix("bootstrap")
        .is_some_and(|suffix| {
            matches!(
                suffix,
                "app"
                    | "application"
                    | "store"
                    | "stores"
                    | "reaction"
                    | "reactions"
                    | "autorun"
                    | "autoruns"
            )
        })
}

fn mobx_symbol_is_module_scoped(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
}

fn mobx_all_direct_calls_are_module_scoped(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let mut found_call = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
            continue;
        };
        if resolve_const_identifier_root_symbol(callee, ctx) != Some(symbol_id) {
            continue;
        }
        found_call = true;
        if !mobx_is_evaluated_at_module_scope(candidate, ctx) {
            return false;
        }
    }
    found_call
}

fn mobx_constructor_has_process_lifetime(
    constructor_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(class_node) = ctx
        .nodes()
        .ancestors(constructor_node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
    else {
        return false;
    };
    let AstKind::Class(class) = class_node.kind() else {
        return false;
    };
    let class_root = transparent_expression_root(class_node, ctx);
    let parent = ctx.nodes().parent_node(class_root.id());
    if let AstKind::NewExpression(new_expression) = parent.kind()
        && new_expression
            .callee
            .span()
            .contains_inclusive(class_root.span())
    {
        return mobx_is_evaluated_at_module_scope(parent, ctx);
    }
    let symbol_id = if let AstKind::VariableDeclarator(declarator) = parent.kind() {
        declarator
            .id
            .get_binding_identifier()
            .map(|binding| binding.symbol_id())
    } else {
        class.id.as_ref().map(|identifier| identifier.symbol_id())
    };
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    let mut found_instantiation = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::NewExpression(new_expression) = candidate.kind() else {
            continue;
        };
        let Expression::Identifier(callee) = new_expression.callee.get_inner_expression() else {
            continue;
        };
        if resolve_const_identifier_root_symbol(callee, ctx) != Some(symbol_id) {
            continue;
        }
        found_instantiation = true;
        if !mobx_is_evaluated_at_module_scope(candidate, ctx) {
            return false;
        }
    }
    found_instantiation
}

fn mobx_callback_disposes_reaction<'a, 'b>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    subscription_name: &str,
    ctx: &'b LintContext<'a>,
) -> bool {
    let callback_index = if subscription_name == "autorun" { 0 } else { 1 };
    let parameter_index = if subscription_name == "autorun" { 0 } else { 2 };
    let Some(callback) = call_expression
        .arguments
        .get(callback_index)
        .and_then(Argument::as_expression)
        .and_then(|argument| {
            mobx_resolve_local_function_node(argument, ctx, &mut FxHashSet::default())
        })
    else {
        return false;
    };
    let Some(reaction_symbol_id) = mobx_function_parameter_symbol(callback, parameter_index) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(dispose_call) = candidate.kind() else {
            return false;
        };
        if !callback.span().contains_inclusive(candidate.span())
            || !mobx_call_executes_within_function(
                candidate,
                callback.id(),
                ctx,
                &mut FxHashSet::default(),
            )
        {
            return false;
        }
        let Some(member) = dispose_call.callee.as_member_expression() else {
            return false;
        };
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return false;
        };
        member.static_property_name() == Some("dispose")
            && ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                == Some(reaction_symbol_id)
    })
}

fn mobx_resolve_local_function_node<'a, 'b>(
    expression: &Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'b AstNode<'a>> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::FunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if matches!(declaration.kind(), AstKind::Function(_)) {
                return Some(declaration);
            }
            let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
            mobx_resolve_local_function_node(initializer, ctx, visited_symbol_ids)
        }
        _ => None,
    }
}

fn mobx_function_parameter_symbol(function_node: &AstNode<'_>, index: usize) -> Option<SymbolId> {
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.get(index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(index),
        _ => None,
    }?;
    parameter
        .pattern
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn mobx_call_executes_within_function<'a, 'b>(
    call_node: &'b AstNode<'a>,
    function_node_id: NodeId,
    ctx: &'b LintContext<'a>,
    visiting_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if ancestor.id() == function_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            if !visiting_function_ids.insert(ancestor.id())
                || !mobx_local_function_is_invoked_within(
                    ancestor,
                    function_node_id,
                    ctx,
                    visiting_function_ids,
                )
            {
                return false;
            }
        }
    }
    false
}

fn mobx_local_function_is_invoked_within<'a, 'b>(
    function_node: &'b AstNode<'a>,
    outer_function_node_id: NodeId,
    ctx: &'b LintContext<'a>,
    visiting_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span().contains_inclusive(function_root.span()))
        && mobx_call_executes_within_function(
            parent,
            outer_function_node_id,
            ctx,
            visiting_function_ids,
        )
    {
        return true;
    }
    let symbol_id = match function_node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(_) => None,
        _ => None,
    }
    .or_else(|| {
        let parent = ctx.nodes().parent_node(function_node.id());
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            return None;
        };
        declarator
            .id
            .get_binding_identifier()
            .map(|binding| binding.symbol_id())
    });
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        resolve_const_identifier_root_symbol(callee, ctx) == Some(symbol_id)
            && !function_node.span().contains_inclusive(candidate.span())
            && mobx_call_executes_within_function(
                candidate,
                outer_function_node_id,
                ctx,
                visiting_function_ids,
            )
    })
}

fn mobx_observes_only_instance_rooted_state<'a, 'b>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let observation_index = 0;
    let Some(callback) = call_expression
        .arguments
        .get(observation_index)
        .and_then(Argument::as_expression)
        .and_then(|argument| {
            mobx_resolve_local_function_node(argument, ctx, &mut FxHashSet::default())
        })
    else {
        return false;
    };
    !ctx.nodes().iter().any(|candidate| {
        callback.span().contains_inclusive(candidate.span())
            && mobx_candidate_observes_external_state(candidate, callback, ctx)
    })
}

fn mobx_candidate_observes_external_state<'a, 'b>(
    candidate: &'b AstNode<'a>,
    callback: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    if ctx
        .nodes()
        .ancestors(candidate.id())
        .take_while(|ancestor| ancestor.id() != callback.id())
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    {
        return false;
    }
    match candidate.kind() {
        AstKind::StaticMemberExpression(member) => mobx_member_observes_external_state(
            &member.object,
            Some(member.property.name.as_str()),
            candidate,
            callback,
            ctx,
        ),
        AstKind::ComputedMemberExpression(member) => mobx_member_observes_external_state(
            &member.object,
            member.static_property_name().as_deref(),
            candidate,
            callback,
            ctx,
        ),
        AstKind::PrivateFieldExpression(member) => {
            mobx_member_observes_external_state(&member.object, None, candidate, callback, ctx)
        }
        AstKind::IdentifierReference(identifier) => {
            if mobx_identifier_is_callback_local_or_nonobservable_global(identifier, callback, ctx)
            {
                return false;
            }
            let identifier_root = transparent_expression_root(candidate, ctx);
            let parent = ctx.nodes().parent_node(identifier_root.id());
            match parent.kind() {
                AstKind::StaticMemberExpression(_)
                | AstKind::ComputedMemberExpression(_)
                | AstKind::PrivateFieldExpression(_) => false,
                AstKind::ObjectProperty(property) => {
                    property.value.span() == identifier_root.span()
                }
                AstKind::CallExpression(call) => call
                    .arguments
                    .iter()
                    .filter_map(Argument::as_expression)
                    .any(|argument| argument.span() == identifier_root.span()),
                AstKind::SpreadElement(spread) => spread.argument.span() == identifier_root.span(),
                AstKind::VariableDeclarator(declarator) => {
                    declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == identifier_root.span())
                        && declarator.id.get_binding_identifier().is_none()
                }
                AstKind::ForInStatement(statement) => {
                    statement.right.span() == identifier_root.span()
                }
                AstKind::ForOfStatement(statement) => {
                    statement.right.span() == identifier_root.span()
                }
                AstKind::ArrowFunctionExpression(function) => function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == identifier_root.span()),
                AstKind::ReturnStatement(statement) => statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == identifier_root.span()),
                _ => false,
            }
        }
        _ => false,
    }
}

fn mobx_member_observes_external_state<'a, 'b>(
    member_object: &Expression<'a>,
    property_name: Option<&str>,
    candidate: &'b AstNode<'a>,
    callback: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let mut receiver = member_object.get_inner_expression();
    while let Some(parent_member) = receiver.as_member_expression() {
        receiver = parent_member.object().get_inner_expression();
    }
    let member_root = transparent_expression_root(candidate, ctx);
    let parent = ctx.nodes().parent_node(member_root.id());
    let is_direct_method_call = matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == member_root.span());
    match receiver {
        Expression::ThisExpression(_) => is_direct_method_call,
        Expression::Identifier(identifier) => {
            if mobx_identifier_is_callback_local_or_nonobservable_global(&identifier, callback, ctx)
            {
                return false;
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if symbol_id.is_some_and(|symbol_id| {
                matches!(
                    ctx.symbol_declaration(symbol_id).kind(),
                    AstKind::ImportSpecifier(_)
                        | AstKind::ImportDefaultSpecifier(_)
                        | AstKind::ImportNamespaceSpecifier(_)
                )
            }) && is_direct_method_call
                && property_name.is_some_and(|property_name| {
                    matches!(
                        property_name,
                        "add" | "clear" | "delete" | "remove" | "save" | "set" | "update" | "write"
                    )
                })
            {
                return false;
            }
            true
        }
        _ => true,
    }
}

fn mobx_identifier_is_callback_local_or_nonobservable_global(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    callback: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id();
    if symbol_id.is_some_and(|symbol_id| {
        callback
            .span()
            .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
    }) {
        return true;
    }
    if symbol_id.is_none()
        && matches!(
            identifier.name.as_str(),
            "Array" | "Boolean" | "JSON" | "Math" | "Number" | "Object" | "String" | "console"
        )
    {
        return true;
    }
    false
}

fn mobx_options_may_carry_abort_signal<'a>(
    expression: &'a Expression<'a>,
    call_node: &AstNode<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let object = match expression {
        Expression::ObjectExpression(object) => object,
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return true;
            };
            if !visited_symbol_ids.insert(symbol_id)
                || has_possible_static_property_write_before(
                    identifier,
                    "signal",
                    call_node,
                    property_write_analysis,
                    ctx,
                )
            {
                return true;
            }
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return true;
            };
            return mobx_options_may_carry_abort_signal(
                initializer,
                call_node,
                property_write_analysis,
                ctx,
                visited_symbol_ids,
            );
        }
        _ => return true,
    };
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return true;
        };
        let Some(property_name) = property.key.static_name() else {
            return true;
        };
        if property_name != "signal" {
            continue;
        }
        return !mobx_is_definitely_not_abort_signal(&property.value);
    }
    false
}

fn mobx_is_definitely_not_abort_signal(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier) if identifier.name == "undefined"
    ) || matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::UnaryExpression(_)
            | Expression::BinaryExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
    )
}
