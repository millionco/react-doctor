use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeName, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const TANSTACK_QUERY_MODULE_SOURCES: [&str; 2] = ["@tanstack/react-query", "react-query"];
const DISCARDING_SCHEDULER_NAMES: [&str; 6] = [
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "requestIdleCallback",
    "queueMicrotask",
    "setImmediate",
];
const MESSAGE: &str = "This `mutateAsync()` promise is discarded without a rejection handler, so a failed mutation becomes an unhandled rejection.";

#[derive(Debug, Default, Clone)]
pub struct QueryFloatingMutateAsync;

declare_oxc_lint!(
    /// Warns when a TanStack mutateAsync promise can reject without a handler.
    QueryFloatingMutateAsync,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Floating mutateAsync rejection.",
);

impl Rule for QueryFloatingMutateAsync {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        if !query_floating_is_tanstack_mutate_async_call(call, ctx)
            || !query_floating_is_floating_promise_use(node, ctx, &mut FxHashSet::default())
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }
}

fn query_floating_is_tanstack_mutate_async_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression() {
        if member.static_property_name() != Some("mutateAsync") {
            return false;
        }
        let Expression::Identifier(result) = member.object().get_inner_expression() else {
            return false;
        };
        return query_floating_symbol_is_mutation_result(
            query_floating_reference_symbol_id(result, ctx),
            ctx,
            &mut FxHashSet::default(),
        );
    }
    let Expression::Identifier(identifier) = callee else {
        return false;
    };
    query_floating_symbol_is_mutate_async(
        query_floating_reference_symbol_id(identifier, ctx),
        ctx,
        &mut FxHashSet::default(),
    )
}

fn query_floating_reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn query_floating_symbol_is_mutation_result<'a>(
    symbol_id: Option<SymbolId>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return false;
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if query_floating_is_use_mutation_initializer(initializer, ctx) {
        return true;
    }
    let Expression::Identifier(alias) = initializer.get_inner_expression() else {
        return false;
    };
    query_floating_symbol_is_mutation_result(
        query_floating_reference_symbol_id(alias, ctx),
        ctx,
        visited,
    )
}

fn query_floating_symbol_is_mutate_async<'a>(
    symbol_id: Option<SymbolId>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return false;
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("mutateAsync")
    {
        if query_floating_is_use_mutation_initializer(initializer, ctx) {
            return true;
        }
        if let Expression::Identifier(result) = initializer.get_inner_expression() {
            return query_floating_symbol_is_mutation_result(
                query_floating_reference_symbol_id(result, ctx),
                ctx,
                &mut FxHashSet::default(),
            );
        }
        return false;
    }
    let candidate = initializer.get_inner_expression();
    if let Expression::Identifier(alias) = candidate {
        return query_floating_symbol_is_mutate_async(
            query_floating_reference_symbol_id(alias, ctx),
            ctx,
            visited,
        );
    }
    let Some(member) = candidate.as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("mutateAsync") {
        return false;
    }
    let Expression::Identifier(result) = member.object().get_inner_expression() else {
        return false;
    };
    query_floating_symbol_is_mutation_result(
        query_floating_reference_symbol_id(result, ctx),
        ctx,
        &mut FxHashSet::default(),
    )
}

fn query_floating_is_use_mutation_initializer<'a>(
    initializer: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call_expression) = initializer.get_inner_expression() else {
        return false;
    };
    module_api_path_matches(
        &call_expression.callee,
        &["useMutation"],
        &TANSTACK_QUERY_MODULE_SOURCES,
        false,
        ctx,
    )
}

fn query_floating_is_floating_promise_use<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    let mut current = call_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if query_floating_is_transparent_wrapper(parent)
            || matches!(parent.kind(), AstKind::SpreadElement(spread) if spread.argument.span() == current.span())
        {
            current = parent;
            continue;
        }
        match parent.kind() {
            AstKind::ConditionalExpression(conditional) => {
                if conditional.test.span() == current.span() {
                    return true;
                }
                current = parent;
            }
            AstKind::LogicalExpression(logical) => {
                if logical.left.span() == current.span()
                    && logical.operator == oxc_syntax::operator::LogicalOperator::And
                {
                    return true;
                }
                current = parent;
            }
            AstKind::UnaryExpression(unary) if unary.argument.span() == current.span() => {
                return true;
            }
            AstKind::BinaryExpression(binary)
                if binary.left.span() == current.span()
                    || binary.right.span() == current.span() =>
            {
                return true;
            }
            AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::WhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::DoWhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::ForStatement(statement)
                if statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span() == current.span()) =>
            {
                return true;
            }
            AstKind::SwitchStatement(statement)
                if statement.discriminant.span() == current.span() =>
            {
                return true;
            }
            AstKind::SequenceExpression(sequence) => {
                if sequence
                    .expressions
                    .last()
                    .is_none_or(|last| last.span() != current.span())
                {
                    return true;
                }
                current = parent;
            }
            AstKind::ArrayExpression(_) => {
                let Some(wrapper) = query_floating_rejection_forwarding_promise_call(parent, ctx)
                else {
                    return false;
                };
                current = wrapper;
            }
            AstKind::CallExpression(_) => {
                let Some(wrapper) = query_floating_rejection_forwarding_promise_call(current, ctx)
                else {
                    return false;
                };
                current = wrapper;
            }
            AstKind::StaticMemberExpression(_)
            | AstKind::ComputedMemberExpression(_)
            | AstKind::PrivateFieldExpression(_) => {
                let Some(member) = parent.kind().as_member_expression_kind() else {
                    return false;
                };
                if member.object().span() != current.span() {
                    return false;
                }
                let Some(method_name) = member.static_property_name() else {
                    return false;
                };
                let method_name = method_name.as_ref();
                if !matches!(method_name, "catch" | "then" | "finally") {
                    return false;
                }
                let member_root = transparent_expression_root(parent, ctx);
                let chain_node = ctx.nodes().parent_node(member_root.id());
                let AstKind::CallExpression(chain) = chain_node.kind() else {
                    return false;
                };
                if chain.callee.span() != member_root.span() {
                    return false;
                }
                let rejection_handler = if method_name == "catch" {
                    chain.arguments.first()
                } else {
                    chain.arguments.get(1)
                }
                .and_then(oxc_ast::ast::Argument::as_expression);
                if matches!(method_name, "catch" | "then")
                    && query_floating_is_possible_callable(
                        rejection_handler,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                {
                    return false;
                }
                current = chain_node;
            }
            AstKind::AwaitExpression(await_expression)
                if await_expression.argument.span() == current.span() =>
            {
                let Some(function_node) = crate::ast_util::get_enclosing_function(parent, ctx)
                else {
                    return false;
                };
                if query_floating_await_is_guarded(parent, function_node, ctx) {
                    return false;
                }
                return query_floating_function_result_is_discarded(
                    function_node,
                    ctx,
                    visited_functions,
                );
            }
            AstKind::ExpressionStatement(_) => return true,
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                let Some(function_node) = crate::ast_util::get_enclosing_function(parent, ctx)
                else {
                    return false;
                };
                return query_floating_function_result_is_discarded(
                    function_node,
                    ctx,
                    visited_functions,
                );
            }
            AstKind::ArrowFunctionExpression(function)
                if function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == current.span()) =>
            {
                return query_floating_function_result_is_discarded(parent, ctx, visited_functions);
            }
            _ => return false,
        }
    }
}

fn query_floating_is_transparent_wrapper(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_)
    )
}

fn query_floating_rejection_forwarding_promise_call<'a, 'b>(
    current: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let current_root = transparent_expression_root(current, ctx);
    let parent = ctx.nodes().parent_node(current_root.id());
    if let AstKind::CallExpression(call) = parent.kind()
        && call
            .arguments
            .iter()
            .filter_map(oxc_ast::ast::Argument::as_expression)
            .any(|argument| argument.span() == current_root.span())
        && query_floating_promise_method_name(call, ctx)
            .is_some_and(|name| matches!(name, "all" | "any" | "race" | "resolve"))
    {
        return Some(parent);
    }
    let AstKind::ArrayExpression(_) = current_root.kind() else {
        return None;
    };
    let array_root = transparent_expression_root(current_root, ctx);
    let call_node = ctx.nodes().parent_node(array_root.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return None;
    };
    call.arguments
        .iter()
        .filter_map(oxc_ast::ast::Argument::as_expression)
        .any(|argument| argument.span() == array_root.span())
        .then(|| query_floating_promise_method_name(call, ctx))
        .flatten()
        .filter(|name| matches!(*name, "all" | "any" | "race"))
        .map(|_| call_node)
}

fn query_floating_promise_method_name<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    is_proven_global_namespace_reference(member.object(), "Promise", ctx)
        .then(|| member.static_property_name())
        .flatten()
}

fn query_floating_is_possible_callable<'a>(
    expression: Option<&Expression<'a>>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(expression) = expression else {
        return false;
    };
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) || expression.as_member_expression().is_some()
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    if identifier.name == "undefined" {
        return false;
    }
    let Some(symbol_id) = query_floating_reference_symbol_id(identifier, ctx) else {
        return false;
    };
    if !visited.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(
        declaration.kind(),
        AstKind::Function(_)
            | AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
            | AstKind::FormalParameter(_)
    ) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    query_floating_is_possible_callable(declarator.init.as_ref(), ctx, visited)
}

fn query_floating_await_is_guarded<'a>(
    await_node: &AstNode<'a>,
    boundary: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_id = await_node.id();
    for ancestor in ctx.nodes().ancestors(await_node.id()) {
        if ancestor.id() == boundary.id() {
            break;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.node_id.get() == child_id
            && statement.handler.is_some()
        {
            return true;
        }
        child_id = ancestor.id();
    }
    false
}

fn query_floating_function_result_is_discarded<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_functions.insert(function_node.id()) {
        return false;
    }
    if query_floating_is_event_handler_value(function_node, ctx)
        || query_floating_is_effect_callback_value(function_node, ctx)
        || query_floating_is_discarded_callback_value(function_node, ctx)
    {
        return true;
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let immediate_parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::CallExpression(call) = immediate_parent.kind()
        && call.callee.span().contains_inclusive(function_node.span())
    {
        return query_floating_is_floating_promise_use(immediate_parent, ctx, visited_functions);
    }
    let Some(binding_symbol_id) = query_floating_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    let mut symbol_ids = vec![binding_symbol_id];
    let mut seen_symbols = FxHashSet::from_iter([binding_symbol_id]);
    let mut index = 0;
    while index < symbol_ids.len() {
        let symbol_id = symbol_ids[index];
        index += 1;
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if query_floating_is_event_handler_value(reference_node, ctx)
                || query_floating_is_effect_callback_value(reference_node, ctx)
                || query_floating_is_discarded_callback_value(reference_node, ctx)
            {
                return true;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if let AstKind::CallExpression(call) = parent.kind()
                && call.callee.span() == reference_root.span()
                && query_floating_is_floating_promise_use(parent, ctx, visited_functions)
            {
                return true;
            }
            if let AstKind::VariableDeclarator(declarator) = parent.kind()
                && declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == reference_root.span())
                && let BindingPattern::BindingIdentifier(alias) = &declarator.id
            {
                let declaration = ctx.nodes().parent_node(parent.id());
                if matches!(declaration.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                    && seen_symbols.insert(alias.symbol_id())
                {
                    symbol_ids.push(alias.symbol_id());
                }
            }
        }
    }
    false
}

fn query_floating_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    ctx.nodes()
        .ancestors(function_node.id())
        .take_while(|ancestor| {
            !matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find_map(|ancestor| {
            let AstKind::VariableDeclarator(declarator) = ancestor.kind() else {
                return None;
            };
            declarator
                .init
                .as_ref()
                .filter(|initializer| initializer.span().contains_inclusive(function_node.span()))
                .and_then(|_| declarator.id.get_binding_identifier())
                .map(oxc_ast::ast::BindingIdentifier::symbol_id)
        })
}

fn query_floating_callback_selection_root<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let is_selection = match parent.kind() {
            AstKind::ConditionalExpression(conditional) => {
                conditional.test.span() != current.span()
                    && (conditional.consequent.span() == current.span()
                        || conditional.alternate.span() == current.span())
            }
            AstKind::LogicalExpression(logical) => {
                logical.right.span() == current.span()
                    || (logical.left.span() == current.span()
                        && logical.operator != oxc_syntax::operator::LogicalOperator::And)
            }
            AstKind::SequenceExpression(sequence) => sequence
                .expressions
                .last()
                .is_some_and(|expression| expression.span() == current.span()),
            _ => false,
        };
        if !is_selection {
            return current;
        }
        current = transparent_expression_root(parent, ctx);
    }
}

fn query_floating_is_event_handler_value<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let callback = query_floating_callback_selection_root(node, ctx);
    let container = ctx.nodes().parent_node(callback.id());
    if !matches!(container.kind(), AstKind::JSXExpressionContainer(_)) {
        return false;
    }
    let attribute_node = ctx.nodes().parent_node(container.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return false;
    };
    if !attribute_name.name.starts_with("on")
        || !attribute_name
            .name
            .as_bytes()
            .get(2)
            .is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    let opening_node = ctx.nodes().parent_node(attribute_node.id());
    matches!(opening_node.kind(), AstKind::JSXOpeningElement(opening)
        if matches!(&opening.name, JSXElementName::Identifier(identifier)
            if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_lowercase)))
}

fn query_floating_is_effect_callback_value<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let callback = query_floating_callback_selection_root(node, ctx);
    let parent = ctx.nodes().parent_node(callback.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|argument| argument.span().contains_inclusive(callback.span()))
        && is_react_hook_call(call, &["useEffect", "useLayoutEffect"], ctx)
}

fn query_floating_is_discarded_callback_value<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callback = query_floating_callback_selection_root(node, ctx);
    let parent = ctx.nodes().parent_node(callback.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call
        .arguments
        .iter()
        .filter_map(oxc_ast::ast::Argument::as_expression)
        .any(|argument| argument.span().contains_inclusive(callback.span()))
    {
        return false;
    }
    let callee = call.callee.get_inner_expression();
    let method_name = if let Expression::Identifier(identifier) = callee {
        let name = identifier.name.as_str();
        if DISCARDING_SCHEDULER_NAMES.contains(&name)
            && is_proven_global_namespace_reference(callee, name, ctx)
        {
            return true;
        }
        return false;
    } else {
        callee
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name)
    };
    let Some(method_name) = method_name else {
        return false;
    };
    if method_name == "forEach"
        || (DISCARDING_SCHEDULER_NAMES.contains(&method_name)
            && is_proven_global_namespace_reference(callee, method_name, ctx))
    {
        return true;
    }
    matches!(method_name, "map" | "flatMap")
        && query_floating_expression_value_is_discarded(parent, ctx)
}

fn query_floating_expression_value_is_discarded<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if query_floating_is_transparent_wrapper(parent)
            || matches!(parent.kind(), AstKind::SpreadElement(_))
        {
            current = parent;
            continue;
        }
        match parent.kind() {
            AstKind::ConditionalExpression(conditional) => {
                if conditional.test.span() == current.span() {
                    return true;
                }
                current = parent;
            }
            AstKind::LogicalExpression(logical) => {
                if logical.left.span() == current.span()
                    && logical.operator == oxc_syntax::operator::LogicalOperator::And
                {
                    return true;
                }
                current = parent;
            }
            AstKind::UnaryExpression(_) | AstKind::BinaryExpression(_) => return true,
            AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::WhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::DoWhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::ForStatement(statement)
                if statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span() == current.span()) =>
            {
                return true;
            }
            AstKind::SwitchStatement(statement)
                if statement.discriminant.span() == current.span() =>
            {
                return true;
            }
            AstKind::SequenceExpression(sequence) => {
                if sequence
                    .expressions
                    .last()
                    .is_none_or(|last| last.span() != current.span())
                {
                    return true;
                }
                current = parent;
            }
            AstKind::ArrayExpression(_) | AstKind::CallExpression(_) => {
                let Some(wrapper) = query_floating_rejection_forwarding_promise_call(current, ctx)
                else {
                    return false;
                };
                current = wrapper;
            }
            AstKind::ExpressionStatement(_) => return true,
            _ => return false,
        }
    }
}
