use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, Expression, FunctionType, IdentifierReference, JSXAttributeItem,
        JSXAttributeName, JSXAttributeValue, JSXElementName, JSXMemberExpressionObject, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const CONTEXT_MODULE_SOURCES: [&str; 3] = ["react", "use-context-selector", "react-tracked"];
const MESSAGE: &str = "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — memoize it in component scope (extract mapped providers into a child component first), or move it outside the component.";

#[derive(Debug, Default, Clone)]
pub struct ContextProviderValueFromUnmemoizedLocalLiteral;

declare_oxc_lint!(
    /// Disallow render-local fresh literals passed through context value bindings.
    ContextProviderValueFromUnmemoizedLocalLiteral,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow context values from unmemoized local literals.",
);

impl Rule for ContextProviderValueFromUnmemoizedLocalLiteral {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let function_node_ids = context_local_literal_index_function_nodes(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !context_local_literal_is_provider_name(&opening_element.name, ctx)
                || !context_local_literal_executes_in_render(node, ctx)
                || is_inside_stable_react_initializer(node, ctx)
            {
                continue;
            }
            let Some(attribute) = opening_element.attributes.iter().find_map(|attribute| {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    return None;
                };
                matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "value")
                    .then_some(attribute)
            }) else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(Expression::Identifier(value_identifier)) = container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if context_local_literal_identifier_is_fresh(
                value_identifier,
                node,
                ctx,
                &function_node_ids,
            ) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }
}

fn context_local_literal_identifier_is_fresh<'a>(
    identifier: &IdentifierReference<'a>,
    provider_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(render_function) = crate::ast_util::get_enclosing_function(provider_node, ctx) else {
        return false;
    };
    let mut latest_write = None;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let write_node = ctx.nodes().get_node(reference.node_id());
        if write_node.span().start >= identifier.span.start
            || crate::ast_util::get_enclosing_function(write_node, ctx)
                .is_none_or(|function| function.id() != render_function.id())
            || !node_dominates_node(write_node, provider_node, ctx)
        {
            continue;
        }
        let assignment_root = transparent_expression_root(write_node, ctx);
        let assignment_parent = ctx.nodes().parent_node(assignment_root.id());
        let AstKind::AssignmentExpression(assignment) = assignment_parent.kind() else {
            continue;
        };
        if assignment.operator != AssignmentOperator::Assign
            || !matches!(&assignment.left, AssignmentTarget::AssignmentTargetIdentifier(target)
                if ctx.scoping().get_reference(target.reference_id()).symbol_id() == Some(symbol_id))
        {
            continue;
        }
        if latest_write.is_none_or(|(position, _): (u32, &Expression<'a>)| {
            assignment_parent.span().start > position
        }) {
            latest_write = Some((assignment_parent.span().start, &assignment.right));
        }
    }
    if let Some((position, expression)) = context_local_literal_latest_helper_write(
        symbol_id,
        render_function,
        provider_node,
        ctx,
        function_node_ids,
    ) && latest_write.is_none_or(|(latest_position, _)| position > latest_position)
    {
        latest_write = Some((position, expression));
    }
    if let Some((_, expression)) = latest_write {
        return context_local_literal_is_fresh(expression);
    }

    let declaration = ctx.symbol_declaration(symbol_id);
    if crate::ast_util::get_enclosing_function(declaration, ctx)
        .is_none_or(|function| function.id() != render_function.id())
    {
        return false;
    }
    match declaration.kind() {
        AstKind::Function(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            let declaration_is_lexically_scoped = matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if !variable_declaration.kind.is_var()
            );
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    declaration.span().start < identifier.span.start
                        && (declaration_is_lexically_scoped
                            || node_dominates_node(declaration, provider_node, ctx))
                        && context_local_literal_is_fresh(initializer)
                })
        }
        _ => false,
    }
}

fn context_local_literal_index_function_nodes(
    ctx: &LintContext<'_>,
) -> FxHashMap<NodeId, Vec<NodeId>> {
    let mut node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
    for node in ctx.nodes().iter() {
        if let Some(function) = crate::ast_util::get_enclosing_function(node, ctx) {
            node_ids_by_function
                .entry(function.id())
                .or_default()
                .push(node.id());
        }
    }
    node_ids_by_function
}

fn context_local_literal_latest_helper_write<'a>(
    target_symbol: oxc_semantic::SymbolId,
    render_function: &AstNode<'a>,
    provider_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Option<(u32, &'a Expression<'a>)> {
    function_node_ids
        .get(&render_function.id())?
        .iter()
        .filter_map(|candidate_id| {
            let candidate = ctx.nodes().get_node(*candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            if candidate.span().start >= provider_node.span().start
                || !node_dominates_node(candidate, provider_node, ctx)
            {
                return None;
            }
            let function_id = context_local_literal_resolve_local_call_function(
                call_expression,
                ctx,
                &mut Vec::new(),
            )?;
            context_local_literal_last_write_in_function(
                target_symbol,
                function_id,
                ctx,
                function_node_ids,
                &mut vec![render_function.id()],
            )
            .map(|expression| (candidate.span().start, expression))
        })
        .max_by_key(|(position, _)| *position)
}

fn context_local_literal_last_write_in_function<'a>(
    target_symbol: oxc_semantic::SymbolId,
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
    function_node_ids: &FxHashMap<NodeId, Vec<NodeId>>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> Option<&'a Expression<'a>> {
    if visited_function_ids.contains(&function_id) {
        return None;
    }
    let function_owned_node_ids = function_node_ids.get(&function_id)?;
    visited_function_ids.push(function_id);
    let function_node = ctx.nodes().get_node(function_id);
    let suspension_start = context_local_literal_function_is_async(function_node).then(|| {
        function_owned_node_ids
            .iter()
            .map(|candidate_id| ctx.nodes().get_node(*candidate_id))
            .filter(|candidate| matches!(candidate.kind(), AstKind::AwaitExpression(_)))
            .map(|candidate| candidate.span().start)
            .min()
    });
    let suspension_start = suspension_start.flatten();
    let first_return_end = function_owned_node_ids
        .iter()
        .map(|candidate_id| ctx.nodes().get_node(*candidate_id))
        .filter(|candidate| matches!(candidate.kind(), AstKind::ReturnStatement(_)))
        .map(|candidate| candidate.span().end)
        .min();
    let mut definitions = Vec::new();
    for candidate_id in function_owned_node_ids {
        let candidate = ctx.nodes().get_node(*candidate_id);
        if !context_local_literal_is_unconditional_function_node(candidate, function_node, ctx)
            || suspension_start.is_some_and(|start| candidate.span().end > start)
            || first_return_end.is_some_and(|end| {
                candidate.span().start >= end
                    && !ctx
                        .nodes()
                        .ancestors(candidate.id())
                        .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
            })
        {
            continue;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign
                    && matches!(&assignment.left, AssignmentTarget::AssignmentTargetIdentifier(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(target_symbol)) =>
            {
                definitions.push((candidate.span().start, &assignment.right));
            }
            AstKind::CallExpression(call_expression) => {
                let Some(called_function_id) = context_local_literal_resolve_local_call_function(
                    call_expression,
                    ctx,
                    &mut Vec::new(),
                ) else {
                    continue;
                };
                if let Some(expression) = context_local_literal_last_write_in_function(
                    target_symbol,
                    called_function_id,
                    ctx,
                    function_node_ids,
                    visited_function_ids,
                ) {
                    definitions.push((candidate.span().start, expression));
                }
            }
            _ => {}
        }
    }
    visited_function_ids.pop();
    definitions
        .into_iter()
        .max_by_key(|(position, _)| *position)
        .map(|(_, expression)| expression)
}

fn context_local_literal_resolve_local_call_function(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::NodeId> {
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    context_local_literal_resolve_function_symbol(symbol_id, ctx, visited_symbol_ids)
}

fn context_local_literal_resolve_function_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::NodeId> {
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
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => match declarator
            .init
            .as_ref()?
            .get_inner_expression()
        {
            Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
            Expression::FunctionExpression(function) => Some(function.node_id.get()),
            Expression::Identifier(alias) => {
                let alias_symbol = ctx
                    .scoping()
                    .get_reference(alias.reference_id())
                    .symbol_id()?;
                context_local_literal_resolve_function_symbol(alias_symbol, ctx, visited_symbol_ids)
            }
            _ => None,
        },
        _ => None,
    }
}

fn context_local_literal_function_is_async(function_node: &AstNode<'_>) -> bool {
    match function_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn context_local_literal_is_unconditional_function_node<'a>(
    node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|ancestor| ancestor.id() != function_node.id())
        .all(|ancestor| {
            !matches!(
                ancestor.kind(),
                AstKind::IfStatement(_)
                    | AstKind::ConditionalExpression(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchStatement(_)
                    | AstKind::TryStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
            )
        })
}

fn context_local_literal_executes_in_render<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    if context_local_literal_is_deferred_callback_binding(function_node, ctx) {
        return false;
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    let direct_parent = ctx.nodes().parent_node(expression_root.id());
    let is_named_inline_function = matches!(
        function_node.kind(),
        AstKind::Function(function)
            if function.r#type == FunctionType::FunctionExpression && function.id.is_some()
    ) && matches!(direct_parent.kind(), AstKind::CallExpression(call_expression)
    if !context_local_literal_is_component_hoc_argument(
        call_expression,
        expression_root.span(),
    ));
    if !is_named_inline_function && component_or_hook_function_name(function_node, ctx).is_some() {
        return true;
    }
    if let AstKind::CallExpression(call_expression) = direct_parent.kind()
        && call_expression.callee.span() == expression_root.span()
        && function_executes_during_render(function_node, ctx)
        && context_local_literal_call_reaches_render_output(direct_parent, ctx)
    {
        return true;
    }
    if let AstKind::CallExpression(call_expression) = direct_parent.kind()
        && let Some(argument_index) = call_expression.arguments.iter().position(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span() == expression_root.span())
        })
        && (function_executes_during_render(function_node, ctx)
            || context_local_literal_custom_renderer_returns_argument(
                call_expression,
                argument_index,
                ctx,
            ))
        && context_local_literal_call_reaches_render_output(direct_parent, ctx)
    {
        return true;
    }
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        let is_first_argument = call_expression.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        });
        if !is_first_argument
            || !matches!(call_expression.callee_name(), Some("memo" | "forwardRef"))
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    context_local_literal_is_default_exported_function(function_node, ctx)
}

fn context_local_literal_is_default_exported_function<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        let is_first_argument = call_expression.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        });
        if !is_first_argument
            || !matches!(call_expression.callee_name(), Some("memo" | "forwardRef"))
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    matches!(
        ctx.nodes().parent_node(expression_root.id()).kind(),
        AstKind::ExportDefaultDeclaration(_)
    )
}

fn context_local_literal_is_component_hoc_argument(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    function_span: oxc_span::Span,
) -> bool {
    expression_is_argument_at(&call_expression.arguments, 0, function_span)
        && matches!(
            call_expression.callee_name(),
            Some("memo" | "forwardRef" | "observer" | "lazy")
        )
}

fn context_local_literal_is_deferred_callback_binding<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = context_local_literal_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .collect::<Vec<_>>();
    if references.is_empty() {
        return false;
    }
    let mut has_synchronous_renderer = false;
    for reference in references {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let expression_root = transparent_expression_root(reference_node, ctx);
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            return false;
        };
        let Some(argument_index) = call_expression.arguments.iter().position(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span() == expression_root.span())
        }) else {
            return false;
        };
        if argument_index == 0
            && matches!(call_expression.callee_name(), Some("memo" | "forwardRef"))
        {
            return false;
        }
        if context_local_literal_custom_renderer_returns_argument(
            call_expression,
            argument_index,
            ctx,
        ) && context_local_literal_call_reaches_render_output(parent, ctx)
        {
            has_synchronous_renderer = true;
        }
    }
    !has_synchronous_renderer
}

fn context_local_literal_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let expression_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn context_local_literal_custom_renderer_returns_argument<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    argument_index: usize,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = match declaration.kind() {
        AstKind::Function(function) => ctx.nodes().get_node(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            let Some(initializer) = &declarator.init else {
                return false;
            };
            match initializer.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => {
                    ctx.nodes().get_node(function.node_id.get())
                }
                Expression::FunctionExpression(function) => {
                    ctx.nodes().get_node(function.node_id.get())
                }
                _ => return false,
            }
        }
        _ => return false,
    };
    let (parameter, returned_expression) = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => {
            let Some(parameter) = function.params.items.get(argument_index) else {
                return false;
            };
            let returned_expression = if let Some(expression) = function.get_expression() {
                expression
            } else {
                let Some(body) = function.body.as_function_body() else {
                    return false;
                };
                let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                    return false;
                };
                let Some(expression) = &statement.argument else {
                    return false;
                };
                expression
            };
            (parameter, returned_expression)
        }
        AstKind::Function(function) if !function.r#async && !function.generator => {
            let Some(parameter) = function.params.items.get(argument_index) else {
                return false;
            };
            let Some(body) = &function.body else {
                return false;
            };
            let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                return false;
            };
            let Some(expression) = &statement.argument else {
                return false;
            };
            (parameter, expression)
        }
        _ => return false,
    };
    let Some(parameter_symbol) = parameter
        .pattern
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
    else {
        return false;
    };
    let Expression::CallExpression(returned_call) = returned_expression.get_inner_expression()
    else {
        return false;
    };
    matches!(returned_call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(parameter_symbol))
}

fn context_local_literal_call_reaches_render_output<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(owner) = crate::ast_util::get_enclosing_function(call_node, ctx) else {
        return false;
    };
    if component_or_hook_function_name(owner, ctx).is_none()
        && !context_local_literal_is_default_exported_function(owner, ctx)
    {
        return false;
    }
    context_local_literal_node_reaches_render_output(
        call_node,
        owner,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn context_local_literal_node_reaches_render_output<'a>(
    node: &AstNode<'a>,
    owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let mut current = node;
    let mut is_create_element_children_property = false;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                return true;
            }
            AstKind::ArrowFunctionExpression(function)
                if parent.id() == owner.id()
                    && function
                        .get_expression()
                        .is_some_and(|expression| expression.span() == current.span()) =>
            {
                return true;
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_) => {}
            AstKind::ConditionalExpression(expression)
                if context_local_literal_conditional_preserves_child_value(
                    expression,
                    current.span(),
                ) => {}
            AstKind::LogicalExpression(expression)
                if context_local_literal_logical_preserves_child_value(
                    expression,
                    current.span(),
                ) => {}
            AstKind::SequenceExpression(expression)
                if expression
                    .expressions
                    .last()
                    .is_some_and(|expression| expression.span() == current.span()) => {}
            AstKind::AssignmentExpression(expression)
                if expression.operator == AssignmentOperator::Assign
                    && expression.right.span() == current.span() => {}
            AstKind::AwaitExpression(expression)
                if expression.argument.span() == current.span() => {}
            AstKind::ArrayExpression(_) => {}
            AstKind::SpreadElement(spread) if spread.argument.span() == current.span() => {}
            AstKind::JSXExpressionContainer(container)
                if container
                    .expression
                    .as_expression()
                    .is_some_and(|expression| expression.span() == current.span()) => {}
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => {}
            AstKind::ObjectProperty(property)
                if !is_create_element_children_property
                    && !property.computed
                    && property.value.span() == current.span()
                    && property.key.static_name().as_deref() == Some("children") =>
            {
                is_create_element_children_property = true;
            }
            AstKind::ObjectExpression(_) if is_create_element_children_property => {}
            AstKind::CallExpression(call_expression)
                if context_local_literal_is_react_create_element_call(call_expression, ctx)
                    && call_expression
                        .arguments
                        .iter()
                        .enumerate()
                        .any(|(index, argument)| {
                            argument.as_expression().is_some_and(|argument| {
                                argument.span() == current.span()
                                    && (index >= 2
                                        || (index == 1 && is_create_element_children_property))
                            })
                        }) =>
            {
                is_create_element_children_property = false;
            }
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == current.span()) =>
            {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    return false;
                };
                let declaration_parent = ctx.nodes().parent_node(parent.id());
                if !matches!(declaration_parent.kind(), AstKind::VariableDeclaration(declaration)
                    if declaration.kind.is_const())
                    || !visited_symbol_ids.insert(binding.symbol_id())
                {
                    return false;
                }
                let mut does_reach_output = false;
                for reference in ctx.scoping().get_resolved_references(binding.symbol_id()) {
                    if !reference.is_read() || reference.is_write() {
                        continue;
                    }
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    if crate::ast_util::get_enclosing_function(reference_node, ctx)
                        .is_none_or(|function| function.id() != owner.id())
                    {
                        continue;
                    }
                    if context_local_literal_node_reaches_render_output(
                        reference_node,
                        owner,
                        ctx,
                        visited_symbol_ids,
                    ) {
                        does_reach_output = true;
                        break;
                    }
                }
                visited_symbol_ids.remove(&binding.symbol_id());
                return does_reach_output;
            }
            _ => return false,
        }
        current = parent;
    }
}

fn context_local_literal_conditional_preserves_child_value(
    expression: &oxc_ast::ast::ConditionalExpression<'_>,
    child_span: oxc_span::Span,
) -> bool {
    match static_literal_truthiness(expression.test.get_inner_expression()) {
        Some(true) => expression.consequent.span() == child_span,
        Some(false) => expression.alternate.span() == child_span,
        None => {
            expression.consequent.span() == child_span || expression.alternate.span() == child_span
        }
    }
}

fn context_local_literal_logical_preserves_child_value(
    expression: &oxc_ast::ast::LogicalExpression<'_>,
    child_span: oxc_span::Span,
) -> bool {
    if expression.left.span() == child_span {
        return expression.operator != oxc_syntax::operator::LogicalOperator::And;
    }
    if expression.right.span() != child_span {
        return false;
    }
    let left = expression.left.get_inner_expression();
    match expression.operator {
        oxc_syntax::operator::LogicalOperator::And => {
            static_literal_truthiness(left).is_none_or(|truthiness| truthiness)
        }
        oxc_syntax::operator::LogicalOperator::Or => {
            static_literal_truthiness(left).is_none_or(|truthiness| !truthiness)
        }
        oxc_syntax::operator::LogicalOperator::Coalesce => {
            static_literal_truthiness(left).is_none() || matches!(left, Expression::NullLiteral(_))
        }
    }
}

fn context_local_literal_is_react_create_element_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_path_matches(
        &call_expression.callee,
        &["createElement"],
        &["react"],
        true,
        ctx,
    ) || context_local_literal_is_global_react_member_call(call_expression, "createElement", ctx)
}

fn context_local_literal_is_fresh(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
    )
}

fn context_local_literal_is_provider_name<'a>(
    name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match name {
        JSXElementName::MemberExpression(member_expression)
            if member_expression.property.name == "Provider" =>
        {
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            context_local_literal_is_known_context_identifier(identifier, true, ctx)
        }
        JSXElementName::IdentifierReference(identifier) => {
            context_local_literal_is_context_module_named_import(identifier, ctx)
                || context_local_literal_is_known_context_identifier(identifier, false, ctx)
        }
        _ => false,
    }
}

fn context_local_literal_is_known_context_identifier<'a>(
    identifier: &IdentifierReference<'a>,
    allow_context_named_import: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if allow_context_named_import && context_local_literal_is_context_named_import(identifier, ctx)
    {
        return true;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if context_local_literal_is_context_binding_symbol(symbol_id, ctx) {
        return true;
    }
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    ctx.nodes().iter().any(|candidate| {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            return false;
        };
        let Some(binding_identifier) = declarator.id.get_binding_identifier() else {
            return false;
        };
        binding_identifier.name == identifier.name
            && ctx
                .scoping()
                .symbol_scope_id(binding_identifier.symbol_id())
                == symbol_scope_id
            && context_local_literal_is_stable_top_level_context_symbol(
                binding_identifier.symbol_id(),
                ctx,
            )
            && context_local_literal_is_context_declarator(
                candidate,
                declarator,
                binding_identifier.symbol_id(),
                ctx,
            )
    })
}

fn context_local_literal_is_context_binding_symbol<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    if !context_local_literal_is_stable_top_level_context_symbol(symbol_id, ctx) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    context_local_literal_is_context_declarator(declaration, declarator, symbol_id, ctx)
}

fn context_local_literal_is_stable_top_level_context_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
        && !ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
}

fn context_local_literal_is_context_declarator<'a>(
    declaration: &AstNode<'a>,
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    module_api_path_matches(
        &call_expression.callee,
        &["createContext"],
        &CONTEXT_MODULE_SOURCES,
        true,
        ctx,
    ) || context_local_literal_is_global_react_create_context_call(call_expression, ctx)
}

fn context_local_literal_is_context_named_import<'a>(
    identifier: &IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
        identifier.name.ends_with("Context")
            || matches!(
                &entry.import_name,
                ImportImportName::Name(imported_name) if imported_name.name().ends_with("Context")
            )
    })
}

fn context_local_literal_is_context_module_named_import<'a>(
    identifier: &IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    context_local_literal_is_context_named_import(identifier, ctx)
        && resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
            entry
                .module_request
                .name()
                .rsplit('/')
                .next()
                .is_some_and(|segment| segment == "context")
        })
}

fn context_local_literal_is_global_react_create_context_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    context_local_literal_is_global_react_member_call(call_expression, "createContext", ctx)
}

fn context_local_literal_is_global_react_member_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    member_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return false;
    };
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
        && member_expression.static_property_name() == Some(member_name)
}
