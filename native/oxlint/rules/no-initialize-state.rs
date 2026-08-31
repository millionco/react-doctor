use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, ExportDefaultDeclarationKind, Expression,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const INITIALIZE_STATE_PURE_GLOBAL_CALLS: [&str; 10] = [
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
const INITIALIZE_STATE_PURE_MEMBER_CALLS: [&str; 14] = [
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
const INITIALIZE_STATE_SYNCHRONOUS_ITERATOR_CALLS: [&str; 10] = [
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
const INITIALIZE_STATE_DEFERRED_CALLS: [&str; 6] = [
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
];
const INITIALIZE_STATE_DEFERRED_MEMBER_CALLS: [&str; 3] = ["catch", "finally", "then"];
const INITIALIZE_STATE_MAX_IMPORTED_HELPER_DEPTH: usize = 4;

#[derive(Clone, Copy)]
struct InitializeStateSubstitution<'node, 'ast> {
    expression: &'node Expression<'ast>,
    parent_frame_index: usize,
}

#[derive(Clone)]
struct InitializeStateExecutionFrame<'node, 'ast> {
    function_id: NodeId,
    is_deferred: bool,
    substitutions: FxHashMap<SymbolId, InitializeStateSubstitution<'node, 'ast>>,
}

#[derive(Debug, Default, Clone)]
pub struct NoInitializeState;

declare_oxc_lint!(
    /// Warns when a mount-only effect initializes render state.
    NoInitializeState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "State initialized from a mount effect.",
);

impl Rule for NoInitializeState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &["useEffect"], ctx)
            || !matches!(
                effect_call.arguments.get(1).and_then(Argument::as_expression),
                Some(Expression::ArrayExpression(dependencies)) if dependencies.elements.is_empty()
            )
        {
            return;
        }
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some((is_async_callback, callback_span)) =
            resolve_local_react_callback(callback_expression, ctx)
        else {
            return;
        };
        if is_async_callback {
            return;
        }
        let Some(callback_id) = ctx.nodes().iter().find_map(|candidate| {
            (candidate.span() == callback_span
                && matches!(
                    candidate.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ))
            .then_some(candidate.id())
        }) else {
            return;
        };
        let Some(component_id) = initialize_state_nearest_function_id(node.id(), ctx) else {
            return;
        };

        let execution_frames =
            initialize_state_execution_frames(callback_id, effect_call.span, ctx);
        let execution_call_ids = execution_frames
            .iter()
            .filter(|frame| !frame.is_deferred)
            .flat_map(|frame| {
                ctx.nodes().iter().filter_map(|candidate| {
                    (initialize_state_nearest_function_id(candidate.id(), ctx)
                        == Some(frame.function_id)
                        && matches!(candidate.kind(), AstKind::CallExpression(_)))
                    .then_some(candidate.id())
                })
            })
            .collect::<Vec<_>>();

        for (frame_index, frame) in execution_frames.iter().enumerate() {
            if frame.is_deferred {
                continue;
            }
            for candidate in ctx.nodes().iter().filter(|candidate| {
                initialize_state_nearest_function_id(candidate.id(), ctx) == Some(frame.function_id)
            }) {
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
                let Some((
                    state_symbol_id,
                    setter_symbol_id,
                    call_setter_symbol_id,
                    state_declarator_id,
                )) = initialize_state_resolve_use_state_pair(setter_identifier, ctx)
                else {
                    continue;
                };
                let Some(written_value) = setter_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                else {
                    continue;
                };
                if initialize_state_matches_initializer(written_value, state_declarator_id, ctx) {
                    continue;
                }

                let has_independent_writer = initialize_state_has_independent_writer(
                    setter_symbol_id,
                    effect_call.span,
                    component_id,
                    ctx,
                );
                let mut source_state_symbols = FxHashSet::default();
                let is_render_known_copy = initialize_state_expression_is_render_known(
                    written_value,
                    component_id,
                    state_symbol_id,
                    frame_index,
                    &execution_frames,
                    1,
                    ctx,
                    &mut Vec::new(),
                    &mut source_state_symbols,
                );
                let resets_source_state = source_state_symbols.iter().any(|source_symbol_id| {
                    initialize_state_effect_resets_source_state(
                        *source_symbol_id,
                        candidate,
                        &execution_call_ids,
                        ctx,
                    )
                });
                let is_cleanup_managed = initialize_state_cleanup_manages_setter(
                    setter_symbol_id,
                    candidate,
                    callback_id,
                    effect_call.span,
                    ctx,
                );
                let is_render_known_initialization = is_render_known_copy
                    && !has_independent_writer
                    && !resets_source_state
                    && !is_cleanup_managed;
                let is_mount_sentinel = initialize_state_is_render_controlling_mount_sentinel(
                    candidate,
                    callback_id,
                    effect_call,
                    state_symbol_id,
                    call_setter_symbol_id,
                    state_declarator_id,
                    has_independent_writer,
                    resets_source_state,
                    ctx,
                );
                if !is_render_known_initialization && !is_mount_sentinel {
                    continue;
                }

                let state_name = initialize_state_name(state_declarator_id, ctx);
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your users see an extra render with empty \"{state_name}\" because a useEffect sets its starting value."
                    ))
                    .with_label(setter_call.span),
                );
            }
        }
    }
}

fn initialize_state_execution_frames<'node, 'ast>(
    callback_id: NodeId,
    effect_span: Span,
    ctx: &'node LintContext<'ast>,
) -> Vec<InitializeStateExecutionFrame<'node, 'ast>> {
    let mut frames = vec![InitializeStateExecutionFrame {
        function_id: callback_id,
        is_deferred: false,
        substitutions: FxHashMap::default(),
    }];
    let root_frame_index = 0;
    let root_calls = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            effect_span.contains_inclusive(candidate.span())
                && initialize_state_nearest_function_id(candidate.id(), ctx) == Some(callback_id)
                && matches!(candidate.kind(), AstKind::CallExpression(_))
        })
        .map(AstNode::id)
        .collect::<Vec<_>>();

    for call_id in root_calls {
        let call_node = ctx.nodes().get_node(call_id);
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        let member_name = call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .and_then(|member| member.static_property_name());
        let callee_name = match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => member_name,
        };
        let is_deferred = callee_name
            .is_some_and(|name| INITIALIZE_STATE_DEFERRED_CALLS.contains(&name))
            || member_name
                .is_some_and(|name| INITIALIZE_STATE_DEFERRED_MEMBER_CALLS.contains(&name));
        let is_iterator = member_name
            .is_some_and(|name| INITIALIZE_STATE_SYNCHRONOUS_ITERATOR_CALLS.contains(&name));

        if is_iterator {
            let Some(collection_expression) = call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .map(|member| member.object())
            else {
                continue;
            };
            for argument in &call.arguments {
                let Some(callback_expression) = argument.as_expression() else {
                    continue;
                };
                initialize_state_push_execution_frame(
                    &mut frames,
                    callback_expression,
                    false,
                    &[collection_expression],
                    root_frame_index,
                    ctx,
                );
            }
            continue;
        }

        if is_deferred {
            for argument in &call.arguments {
                let Some(callback_expression) = argument.as_expression() else {
                    continue;
                };
                initialize_state_push_execution_frame(
                    &mut frames,
                    callback_expression,
                    true,
                    &[],
                    root_frame_index,
                    ctx,
                );
            }
            continue;
        }

        let arguments = call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .collect::<Vec<_>>();
        initialize_state_push_execution_frame(
            &mut frames,
            &call.callee,
            false,
            &arguments,
            root_frame_index,
            ctx,
        );
    }
    frames
}

fn initialize_state_push_execution_frame<'node, 'ast>(
    frames: &mut Vec<InitializeStateExecutionFrame<'node, 'ast>>,
    callable_expression: &'node Expression<'ast>,
    is_deferred: bool,
    arguments: &[&'node Expression<'ast>],
    parent_frame_index: usize,
    ctx: &'node LintContext<'ast>,
) {
    let Some(function_id) =
        exact_local_callback_function_id(callable_expression, ctx, &mut Vec::new())
    else {
        return;
    };
    if initialize_state_function_is_async_or_generator(function_id, ctx)
        || initialize_state_function_invokes_itself(function_id, ctx)
    {
        return;
    }
    let mut substitutions = FxHashMap::default();
    for (parameter_index, parameter_symbol_id) in
        initialize_state_function_parameter_symbols(function_id, ctx)
            .into_iter()
            .enumerate()
    {
        let Some(parameter_symbol_id) = parameter_symbol_id else {
            continue;
        };
        let Some(&expression) = arguments.get(parameter_index) else {
            continue;
        };
        substitutions.insert(
            parameter_symbol_id,
            InitializeStateSubstitution {
                expression,
                parent_frame_index,
            },
        );
    }
    frames.push(InitializeStateExecutionFrame {
        function_id,
        is_deferred,
        substitutions,
    });
}

fn initialize_state_function_parameter_symbols(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<Option<SymbolId>> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return Vec::new(),
    };
    parameters
        .iter()
        .map(|parameter| {
            parameter
                .pattern
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        })
        .collect()
}

fn initialize_state_function_is_async_or_generator(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async || function.generator,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => true,
    }
}

fn initialize_state_function_invokes_itself(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if initialize_state_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new()) == Some(function_id)
    })
}

fn initialize_state_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn initialize_state_function_is_async(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(node_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn initialize_state_is_in_async_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(function_id) = initialize_state_nearest_function_id(node.id(), ctx) else {
        return false;
    };
    initialize_state_function_is_async(function_id, ctx)
}

fn initialize_state_resolve_use_state_pair<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, SymbolId, SymbolId, NodeId)> {
    let call_setter_symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()?;
    let setter_symbol_id = resolve_const_identifier_root_symbol(setter_identifier, ctx)?;
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
        && declarator.init.as_ref().is_some_and(|initializer| {
            initialize_state_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new())
        }))
    .then_some((
        state_binding.symbol_id(),
        setter_symbol_id,
        call_setter_symbol_id,
        declaration.id(),
    ))
}

fn initialize_state_expression_is_use_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => is_react_hook_call(call, &["useState"], ctx),
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
            let result = if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
            {
                declarator.init.as_ref().is_some_and(|initializer| {
                    initialize_state_expression_is_use_state_tuple(
                        initializer,
                        ctx,
                        visited_symbol_ids,
                    )
                })
            } else {
                false
            };
            visited_symbol_ids.pop();
            result
        }
        _ => false,
    }
}

fn initialize_state_name(state_declarator_id: NodeId, ctx: &LintContext<'_>) -> String {
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().get_node(state_declarator_id).kind()
    else {
        return "<state>".to_string();
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return "<state>".to_string();
    };
    pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .or_else(|| pattern.elements.get(1).and_then(Option::as_ref))
        .and_then(BindingPattern::get_binding_identifier)
        .map_or_else(|| "<state>".to_string(), |binding| binding.name.to_string())
}

fn initialize_state_same_simple_value(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match (left.get_inner_expression(), right.get_inner_expression()) {
        (Expression::Identifier(left), Expression::Identifier(right)) => {
            let left_symbol = ctx.scoping().get_reference(left.reference_id()).symbol_id();
            let right_symbol = ctx
                .scoping()
                .get_reference(right.reference_id())
                .symbol_id();
            if left_symbol.is_some() || right_symbol.is_some() {
                left_symbol.is_some() && left_symbol == right_symbol
            } else {
                left.name == right.name
            }
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            left.value == right.value
        }
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::StaticMemberExpression(left), Expression::StaticMemberExpression(right)) => {
            left.property.name == right.property.name
                && initialize_state_same_simple_value(&left.object, &right.object, ctx)
        }
        (
            Expression::ComputedMemberExpression(left),
            Expression::ComputedMemberExpression(right),
        ) => {
            initialize_state_same_simple_value(&left.object, &right.object, ctx)
                && initialize_state_same_simple_value(&left.expression, &right.expression, ctx)
        }
        (Expression::PrivateFieldExpression(left), Expression::PrivateFieldExpression(right)) => {
            left.field.name == right.field.name
                && initialize_state_same_simple_value(&left.object, &right.object, ctx)
        }
        _ => false,
    }
}

fn initialize_state_matches_initializer(
    written_value: &Expression<'_>,
    state_declarator_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().get_node(state_declarator_id).kind()
    else {
        return false;
    };
    let Some(Expression::CallExpression(initializer_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(initializer_value) = initializer_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return matches!(written_value.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none());
    };
    if let Expression::LogicalExpression(logical) = initializer_value.get_inner_expression()
        && matches!(
            logical.operator,
            oxc_syntax::operator::LogicalOperator::Coalesce
                | oxc_syntax::operator::LogicalOperator::Or
        )
    {
        return initialize_state_same_simple_value(written_value, &logical.left, ctx)
            || initialize_state_same_simple_value(written_value, &logical.right, ctx);
    }
    initialize_state_same_simple_value(written_value, initializer_value, ctx)
}

fn initialize_state_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn initialize_state_is_render_controlling_mount_sentinel<'a>(
    setter_node: &AstNode<'a>,
    callback_id: NodeId,
    effect_call: &oxc_ast::ast::CallExpression<'a>,
    state_symbol_id: SymbolId,
    setter_symbol_id: SymbolId,
    state_declarator_id: NodeId,
    has_independent_writer: bool,
    resets_source_state: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if has_independent_writer
        || resets_source_state
        || initialize_state_nearest_function_id(setter_node.id(), ctx) != Some(callback_id)
    {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().get_node(state_declarator_id).kind()
    else {
        return false;
    };
    let Some(Expression::CallExpression(state_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let AstKind::CallExpression(setter_call) = setter_node.kind() else {
        return false;
    };
    let Some(initial_value) = state_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(written_value) = setter_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(initial_boolean) = initialize_state_static_boolean(initial_value) else {
        return false;
    };
    let Some(written_boolean) = initialize_state_static_boolean(written_value) else {
        return false;
    };
    if initial_boolean == written_boolean {
        return false;
    }
    if ctx
        .scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !effect_call.span.contains_inclusive(reference_node.span()) {
                return false;
            }
            let root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            matches!(parent.kind(), AstKind::CallExpression(call)
                if call.span != setter_call.span && call.callee.span() == root.span())
        })
    {
        return false;
    }
    initialize_state_controls_rendered_output(state_symbol_id, ctx)
}

fn initialize_state_controls_rendered_output(
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(component_id) =
        initialize_state_nearest_function_id(ctx.symbol_declaration(state_symbol_id).id(), ctx)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(state_symbol_id)
        .filter(|reference| {
            !reference.is_write()
                && initialize_state_nearest_function_id(reference.node_id(), ctx)
                    == Some(component_id)
        })
        .any(|reference| {
            initialize_state_expression_controls_output(
                ctx.nodes().get_node(reference.node_id()),
                component_id,
                ctx,
                &mut Vec::new(),
            )
        })
}

fn initialize_state_expression_controls_output<'a>(
    node: &AstNode<'a>,
    component_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::ReturnStatement(return_statement)
            if return_statement
                .argument
                .as_ref()
                .is_some_and(|argument| argument.span() == root.span()) =>
        {
            initialize_state_nearest_function_id(parent.id(), ctx) == Some(component_id)
        }
        AstKind::JSXExpressionContainer(_) | AstKind::JSXAttribute(_) => {
            initialize_state_nearest_function_id(parent.id(), ctx) == Some(component_id)
        }
        AstKind::IfStatement(statement) if statement.test.span() == root.span() => {
            initialize_state_subtree_contains_jsx(statement.consequent.span(), ctx)
                || statement.alternate.as_ref().is_some_and(|alternate| {
                    initialize_state_subtree_contains_jsx(alternate.span(), ctx)
                })
        }
        AstKind::WhileStatement(statement) if statement.test.span() == root.span() => {
            initialize_state_subtree_contains_jsx(statement.body.span(), ctx)
        }
        AstKind::DoWhileStatement(statement) if statement.test.span() == root.span() => {
            initialize_state_subtree_contains_jsx(statement.body.span(), ctx)
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == root.span())
                && matches!(ctx.nodes().parent_node(parent.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()) =>
        {
            let Some(binding) = declarator.id.get_binding_identifier() else {
                return false;
            };
            let alias_symbol_id = binding.symbol_id();
            if visited_symbol_ids.contains(&alias_symbol_id) {
                return false;
            }
            visited_symbol_ids.push(alias_symbol_id);
            let result = ctx
                .scoping()
                .get_resolved_references(alias_symbol_id)
                .filter(|reference| !reference.is_write())
                .any(|reference| {
                    initialize_state_nearest_function_id(reference.node_id(), ctx)
                        == Some(component_id)
                        && initialize_state_expression_controls_output(
                            ctx.nodes().get_node(reference.node_id()),
                            component_id,
                            ctx,
                            visited_symbol_ids,
                        )
                });
            visited_symbol_ids.pop();
            result
        }
        AstKind::ExpressionStatement(_)
        | AstKind::VariableDeclaration(_)
        | AstKind::BlockStatement(_) => false,
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => false,
        _ => initialize_state_expression_controls_output(
            parent,
            component_id,
            ctx,
            visited_symbol_ids,
        ),
    }
}

fn initialize_state_subtree_contains_jsx(span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && matches!(
                candidate.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            )
    })
}

fn initialize_state_has_independent_writer(
    setter_symbol_id: SymbolId,
    effect_span: Span,
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
            let is_writer = matches!(parent.kind(), AstKind::CallExpression(call)
                if call.callee.span() == root.span()
                    || call.arguments.iter().any(|argument| argument.as_expression().is_some_and(|expression| expression.span() == root.span())))
                || is_inside_inline_event_handler(reference_node.id(), component_id, ctx);
            is_writer
                && (is_inside_proven_event_handler(
                    reference_node.id(),
                    component_id,
                    true,
                    0,
                    ctx,
                ) || initialize_state_is_inside_deferred_writer(
                    reference_node.id(),
                    component_id,
                    ctx,
                ))
        })
}

fn initialize_state_is_inside_deferred_writer(
    node_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_id {
            return false;
        }
        match ancestor.kind() {
            AstKind::Function(function) if function.r#async => return true,
            AstKind::ArrowFunctionExpression(function) if function.r#async => return true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {}
            _ => continue,
        }
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        if !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == ancestor.span())
        }) {
            continue;
        }
        let deferred_name = match call.callee.get_inner_expression() {
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

fn initialize_state_cleanup_manages_setter(
    setter_symbol_id: SymbolId,
    current_setter_node: &AstNode<'_>,
    callback_id: NodeId,
    effect_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let has_cleanup = ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        initialize_state_nearest_function_id(candidate.id(), ctx) == Some(callback_id)
            && matches!(
                return_statement
                    .argument
                    .as_ref()
                    .map(Expression::get_inner_expression),
                Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))
            )
    });
    has_cleanup
        && ctx.nodes().iter().any(|candidate| {
            if candidate.span() == current_setter_node.span()
                || !effect_span.contains_inclusive(candidate.span())
            {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return false;
            };
            initialize_state_resolve_use_state_pair(identifier, ctx).is_some_and(
                |(_, candidate_setter_symbol_id, _, _)| {
                    candidate_setter_symbol_id == setter_symbol_id
                        && initialize_state_is_inside_deferred_writer(
                            candidate.id(),
                            callback_id,
                            ctx,
                        )
                },
            )
        })
}

fn initialize_state_effect_resets_source_state(
    source_state_symbol_id: SymbolId,
    write_node: &AstNode<'_>,
    execution_call_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> bool {
    execution_call_ids.iter().copied().any(|candidate_id| {
        let candidate = ctx.nodes().get_node(candidate_id);
        if initialize_state_is_in_async_function(candidate, ctx)
            || are_nodes_in_mutually_exclusive_branches(candidate, write_node, ctx)
        {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        initialize_state_resolve_use_state_pair(identifier, ctx)
            .is_some_and(|(state_symbol_id, _, _, _)| state_symbol_id == source_state_symbol_id)
    })
}

fn initialize_state_expression_is_render_known<'node, 'ast>(
    expression: &'node Expression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    frame_index: usize,
    frames: &[InitializeStateExecutionFrame<'node, 'ast>],
    remaining_call_frames: usize,
    ctx: &'node LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        let Some(function_id) = exact_local_callback_function_id(expression, ctx, &mut Vec::new())
        else {
            return false;
        };
        if initialize_state_function_is_async_or_generator(function_id, ctx) {
            return false;
        }
        let mut updater_frames = frames.to_vec();
        initialize_state_push_execution_frame(
            &mut updater_frames,
            expression,
            frames[frame_index].is_deferred,
            &[],
            frame_index,
            ctx,
        );
        if updater_frames.len() == frames.len() {
            return false;
        }
        let updater_frame_index = updater_frames.len() - 1;
        let mut returned_expression_count = 0;
        let mut all_returns_are_render_known = true;
        initialize_state_for_each_returned_expression(function_id, ctx, |returned_expression| {
            returned_expression_count += 1;
            all_returns_are_render_known &= initialize_state_expression_is_render_known(
                returned_expression,
                component_id,
                written_state_symbol_id,
                updater_frame_index,
                &updater_frames,
                remaining_call_frames,
                ctx,
                visited_symbol_ids,
                source_state_symbols,
            );
        });
        return returned_expression_count > 0 && all_returns_are_render_known;
    }
    let expression_span = expression.span();
    let mut has_source = false;
    let mut opaque_call_spans = Vec::new();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if initialize_state_is_pure_call(call, ctx)
            || opaque_call_spans
                .iter()
                .any(|span: &Span| span.contains_inclusive(candidate.span()))
        {
            continue;
        }
        if !initialize_state_call_result_is_render_known(
            call,
            component_id,
            written_state_symbol_id,
            frame_index,
            frames,
            remaining_call_frames,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
        ) {
            return false;
        }
        has_source = true;
        opaque_call_spans.push(candidate.span());
    }
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        if opaque_call_spans
            .iter()
            .any(|span| *span != candidate.span() && span.contains_inclusive(candidate.span()))
        {
            continue;
        }
        if initialize_state_is_inside_ignored_pure_callback(candidate.id(), expression_span, ctx) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if candidate.span() != expression_span =>
            {
                if initialize_state_function_is_ignored_pure_callback(candidate, ctx) {
                    continue;
                }
                return false;
            }
            AstKind::AwaitExpression(_)
            | AstKind::YieldExpression(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::UpdateExpression(_) => return false,
            AstKind::NewExpression(new_expression)
                if !matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "Date" | "Set")
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()) =>
            {
                return false;
            }
            AstKind::CallExpression(call) if !initialize_state_is_pure_call(call, ctx) => continue,
            AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)
                if initialize_state_member_has_locally_constructed_receiver(candidate, ctx) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                if initialize_state_identifier_is_callee(candidate, ctx) {
                    continue;
                }
                if initialize_state_identifier_is_ref_current_object(candidate, ctx) {
                    continue;
                }
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
                            | "Infinity"
                            | "JSON"
                            | "Math"
                            | "NaN"
                            | "Number"
                            | "Object"
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
                if let Some(substitution) = frames[frame_index].substitutions.get(&symbol_id) {
                    if !initialize_state_expression_is_render_known(
                        substitution.expression,
                        component_id,
                        written_state_symbol_id,
                        substitution.parent_frame_index,
                        frames,
                        remaining_call_frames,
                        ctx,
                        visited_symbol_ids,
                        source_state_symbols,
                    ) {
                        return false;
                    }
                    has_source = true;
                    continue;
                }
                let Some(is_source) = initialize_state_symbol_is_render_known(
                    symbol_id,
                    component_id,
                    written_state_symbol_id,
                    frame_index,
                    frames,
                    remaining_call_frames,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                ) else {
                    return false;
                };
                has_source |= is_source;
            }
            AstKind::StaticMemberExpression(member)
                if member.property.name == "current"
                    && initialize_state_expression_is_ref_value(&member.object, ctx) =>
            {
                if !initialize_state_ref_current_is_render_known(
                    &member.object,
                    component_id,
                    written_state_symbol_id,
                    frame_index,
                    frames,
                    remaining_call_frames,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                ) {
                    return false;
                }
                has_source = true;
            }
            AstKind::ComputedMemberExpression(member)
                if member.static_property_name().as_deref() == Some("current")
                    && initialize_state_expression_is_ref_value(&member.object, ctx) =>
            {
                if !initialize_state_ref_current_is_render_known(
                    &member.object,
                    component_id,
                    written_state_symbol_id,
                    frame_index,
                    frames,
                    remaining_call_frames,
                    ctx,
                    visited_symbol_ids,
                    source_state_symbols,
                ) {
                    return false;
                }
                has_source = true;
            }
            _ => {}
        }
    }
    has_source
}

fn initialize_state_call_result_is_render_known<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    frame_index: usize,
    frames: &[InitializeStateExecutionFrame<'node, 'ast>],
    remaining_call_frames: usize,
    ctx: &'node LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if remaining_call_frames == 0 {
        return false;
    }
    let Some(function_id) = exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
    else {
        let Some(used_parameter_indices) =
            initialize_state_imported_helper_used_parameter_indices(call, ctx)
        else {
            return false;
        };
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
            if !initialize_state_expression_is_render_known(
                argument,
                component_id,
                written_state_symbol_id,
                frame_index,
                frames,
                remaining_call_frames - 1,
                ctx,
                visited_symbol_ids,
                source_state_symbols,
            ) {
                return false;
            }
            has_source = true;
        }
        return has_source;
    };
    if initialize_state_function_is_async_or_generator(function_id, ctx)
        || initialize_state_function_invokes_itself(function_id, ctx)
        || (initialize_state_function_is_module_scoped(function_id, ctx)
            && !initialize_state_function_returns_exhaustively(function_id, ctx))
    {
        return false;
    }
    let arguments = call
        .arguments
        .iter()
        .filter_map(Argument::as_expression)
        .collect::<Vec<_>>();
    let mut helper_frames = frames.to_vec();
    initialize_state_push_execution_frame(
        &mut helper_frames,
        &call.callee,
        false,
        &arguments,
        frame_index,
        ctx,
    );
    if helper_frames.len() == frames.len() {
        return false;
    }
    let helper_frame_index = helper_frames.len() - 1;
    let mut returned_expression_count = 0;
    let mut all_returns_are_render_known = true;
    initialize_state_for_each_returned_expression(function_id, ctx, |returned_expression| {
        returned_expression_count += 1;
        all_returns_are_render_known &= initialize_state_expression_is_render_known(
            returned_expression,
            component_id,
            written_state_symbol_id,
            helper_frame_index,
            &helper_frames,
            remaining_call_frames - 1,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
        );
    });
    returned_expression_count > 0 && all_returns_are_render_known
}

fn initialize_state_for_each_returned_expression<'node, 'ast>(
    function_id: NodeId,
    ctx: &'node LintContext<'ast>,
    mut visitor: impl FnMut(&'node Expression<'ast>),
) {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        visitor(expression);
        return;
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if initialize_state_nearest_function_id(candidate.id(), ctx) == Some(function_id)
            && let Some(returned_expression) = &return_statement.argument
        {
            visitor(returned_expression);
        }
    }
}

fn initialize_state_function_is_module_scoped(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    initialize_state_nearest_function_id(function_id, ctx).is_none()
}

fn initialize_state_function_returns_exhaustively(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) => {
            function.get_expression().is_some()
                || function.body.as_function_body().is_some_and(|body| {
                    initialize_state_helper_statements_can_continue(&body.statements) == Some(false)
                })
        }
        AstKind::Function(function) => function.body.as_ref().is_some_and(|body| {
            initialize_state_helper_statements_can_continue(&body.statements) == Some(false)
        }),
        _ => false,
    }
}

fn initialize_state_helper_statements_can_continue(statements: &[Statement<'_>]) -> Option<bool> {
    let mut can_continue = true;
    for statement in statements {
        if !can_continue {
            if !matches!(statement, Statement::EmptyStatement(_)) {
                return None;
            }
            continue;
        }
        match statement {
            Statement::EmptyStatement(_) => {}
            Statement::VariableDeclaration(declaration) if declaration.kind.is_const() => {
                if declaration.declarations.iter().any(|declarator| {
                    declarator.id.get_binding_identifier().is_none() || declarator.init.is_none()
                }) {
                    return None;
                }
            }
            Statement::ReturnStatement(statement) => {
                if statement.argument.is_none() {
                    return None;
                }
                can_continue = false;
            }
            Statement::BlockStatement(block) => {
                can_continue = initialize_state_helper_statements_can_continue(&block.body)?;
            }
            Statement::IfStatement(statement) => {
                let consequent_can_continue = match &statement.consequent {
                    Statement::BlockStatement(block) => {
                        initialize_state_helper_statements_can_continue(&block.body)?
                    }
                    consequent => initialize_state_helper_statements_can_continue(
                        std::slice::from_ref(consequent),
                    )?,
                };
                let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                    match alternate {
                        Statement::BlockStatement(block) => {
                            initialize_state_helper_statements_can_continue(&block.body)?
                        }
                        alternate => initialize_state_helper_statements_can_continue(
                            std::slice::from_ref(alternate),
                        )?,
                    }
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

fn initialize_state_symbol_is_render_known<'node, 'ast>(
    symbol_id: SymbolId,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    frame_index: usize,
    frames: &[InitializeStateExecutionFrame<'node, 'ast>],
    remaining_call_frames: usize,
    ctx: &'node LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if initialize_state_nearest_function_id(declaration.id(), ctx) == Some(component_id)
        && (matches!(declaration.kind(), AstKind::FormalParameter(_))
            || ctx
                .nodes()
                .ancestors(declaration.id())
                .take_while(|ancestor| ancestor.id() != component_id)
                .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_))))
    {
        return Some(true);
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if let BindingPattern::ArrayPattern(pattern) = &declarator.id
        && matches!(pattern.elements.first().and_then(Option::as_ref), Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            initialize_state_expression_is_use_state_tuple(initializer, ctx, &mut Vec::new())
        })
    {
        source_state_symbols.insert(symbol_id);
        return Some(true);
    }
    let write_reference_ids = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .map(|reference| reference.node_id())
        .collect::<Vec<_>>();
    if !write_reference_ids.is_empty() {
        let [write_reference_id] = write_reference_ids.as_slice() else {
            return None;
        };
        let write_reference = ctx.nodes().get_node(*write_reference_id);
        let write_root = transparent_expression_root(write_reference, ctx);
        let AstKind::AssignmentExpression(assignment) =
            ctx.nodes().parent_node(write_root.id()).kind()
        else {
            return None;
        };
        let AssignmentTarget::AssignmentTargetIdentifier(assignment_identifier) = &assignment.left
        else {
            return None;
        };
        if assignment.operator != AssignmentOperator::Assign
            || assignment_identifier.span != write_root.span()
        {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let result = initialize_state_expression_is_render_known(
            &assignment.right,
            component_id,
            written_state_symbol_id,
            frame_index,
            frames,
            remaining_call_frames,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
        )
        .then_some(true);
        visited_symbol_ids.pop();
        return result;
    }
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
    {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let result = declarator.init.as_ref().and_then(|initializer| {
        initialize_state_expression_is_render_known(
            initializer,
            component_id,
            written_state_symbol_id,
            frame_index,
            frames,
            remaining_call_frames,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
        )
        .then_some(true)
    });
    visited_symbol_ids.pop();
    result
}

fn initialize_state_expression_is_ref_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
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
    initialize_state_symbol_is_ref_value(symbol_id, ctx, &mut Vec::new())
}

fn initialize_state_symbol_is_ref_value<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let result = if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        declarator.init.as_ref().is_some_and(|initializer| {
            match initializer.get_inner_expression() {
                Expression::CallExpression(call) => is_react_hook_call(call, &["useRef"], ctx),
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|source_symbol_id| {
                        initialize_state_symbol_is_ref_value(
                            source_symbol_id,
                            ctx,
                            visited_symbol_ids,
                        )
                    }),
                _ => false,
            }
        })
    } else {
        false
    };
    visited_symbol_ids.pop();
    result
}

fn initialize_state_identifier_is_ref_current_object<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(node, ctx);
    match ctx.nodes().parent_node(root.id()).kind() {
        AstKind::StaticMemberExpression(member) => {
            member.property.name == "current" && member.object.span() == root.span()
        }
        AstKind::ComputedMemberExpression(member) => {
            member.static_property_name().as_deref() == Some("current")
                && member.object.span() == root.span()
        }
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn initialize_state_ref_current_is_render_known<'node, 'ast>(
    object: &'node Expression<'ast>,
    component_id: NodeId,
    written_state_symbol_id: SymbolId,
    frame_index: usize,
    frames: &[InitializeStateExecutionFrame<'node, 'ast>],
    remaining_call_frames: usize,
    ctx: &'node LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    source_state_symbols: &mut FxHashSet<SymbolId>,
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

    visited_symbol_ids.push(symbol_id);
    let mut has_source = false;
    if let Some(initial_value) = ref_call.arguments.first().and_then(Argument::as_expression) {
        if !initialize_state_expression_is_render_known(
            initial_value,
            component_id,
            written_state_symbol_id,
            frame_index,
            frames,
            remaining_call_frames,
            ctx,
            visited_symbol_ids,
            source_state_symbols,
        ) {
            visited_symbol_ids.pop();
            return false;
        }
        has_source = true;
    }

    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        let member_node = ctx.nodes().parent_node(reference_root.id());
        let is_current_member = match member_node.kind() {
            AstKind::StaticMemberExpression(member) => {
                member.property.name == "current" && member.object.span() == reference_root.span()
            }
            AstKind::ComputedMemberExpression(member) => {
                member.static_property_name().as_deref() == Some("current")
                    && member.object.span() == reference_root.span()
            }
            _ => false,
        };
        if !is_current_member {
            visited_symbol_ids.pop();
            return false;
        }
        let member_root = transparent_expression_root(member_node, ctx);
        let member_parent = ctx.nodes().parent_node(member_root.id());
        let AstKind::AssignmentExpression(assignment) = member_parent.kind() else {
            if matches!(member_parent.kind(), AstKind::UpdateExpression(_)) {
                visited_symbol_ids.pop();
                return false;
            }
            continue;
        };
        if assignment.left.span() != member_root.span()
            || assignment.operator != AssignmentOperator::Assign
            || !initialize_state_expression_is_render_known(
                &assignment.right,
                component_id,
                written_state_symbol_id,
                frame_index,
                frames,
                remaining_call_frames,
                ctx,
                visited_symbol_ids,
                source_state_symbols,
            )
        {
            visited_symbol_ids.pop();
            return false;
        }
        has_source = true;
    }
    visited_symbol_ids.pop();
    has_source
}

fn initialize_state_identifier_is_callee<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == root.span())
}

fn initialize_state_is_inside_ignored_pure_callback(
    node_id: NodeId,
    expression_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| initialize_state_function_is_ignored_pure_callback(ancestor, ctx))
}

fn initialize_state_function_is_ignored_pure_callback(
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
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) && initialize_state_is_pure_call(call, ctx)
}

fn initialize_state_member_has_locally_constructed_receiver(
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

fn initialize_state_imported_helper_used_parameter_indices(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<FxHashSet<usize>> {
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
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return None,
    };
    if !ctx.file_path().is_absolute() {
        return None;
    }
    let helper_path = initialize_state_resolve_first_party_module_path(
        ctx.file_path(),
        import_entry.module_request.name(),
    )?;
    initialize_state_foreign_helper_summary(
        &helper_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    )
}

fn initialize_state_resolve_first_party_module_path(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
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
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn initialize_state_foreign_helper_summary(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<FxHashSet<usize>> {
    if depth >= INITIALIZE_STATE_MAX_IMPORTED_HELPER_DEPTH {
        return None;
    }
    let canonical_path =
        std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = SourceType::from_path(file_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_id) =
        initialize_state_foreign_exported_function_id(exported_name, &semantic, &module_record)
    {
        return initialize_state_foreign_function_summary(function_id, &semantic);
    }
    if exported_name == "default"
        && let Some(function_id) = initialize_state_foreign_default_function_id(&semantic)
    {
        return initialize_state_foreign_function_summary(function_id, &semantic);
    }
    if let Some((module_source, imported_name)) =
        initialize_state_foreign_reexport_target(exported_name, &module_record)
        && let Some(reexport_path) =
            initialize_state_resolve_first_party_module_path(file_path, module_source)
    {
        return initialize_state_foreign_helper_summary(
            &reexport_path,
            imported_name,
            depth + 1,
            &mut visited_paths.clone(),
        );
    }

    let mut resolved_export_all = None;
    for statement in &program.body {
        let Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(reexport_path) = initialize_state_resolve_first_party_module_path(
            file_path,
            declaration.source.value.as_str(),
        ) else {
            continue;
        };
        let Some(candidate) = initialize_state_foreign_helper_summary(
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

fn initialize_state_foreign_exported_function_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let matches = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            matches.then(|| entry.local_name.name()).flatten()
        })?;
    let symbol_id = semantic.scoping().get_root_binding(local_name.into())?;
    initialize_state_foreign_function_id_for_symbol(symbol_id, semantic, &mut Vec::new())
}

fn initialize_state_foreign_default_function_id(semantic: &Semantic<'_>) -> Option<NodeId> {
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                Some(function.node_id.get())
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
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
                initialize_state_foreign_function_id_for_symbol(
                    symbol_id,
                    semantic,
                    &mut Vec::new(),
                )
            }
        }
    })
}

fn initialize_state_foreign_function_id_for_symbol(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = semantic.symbol_declaration(symbol_id);
    let result = match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .and_then(|alias_symbol_id| {
                        initialize_state_foreign_function_id_for_symbol(
                            alias_symbol_id,
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

fn initialize_state_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let entry_exported_name = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
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

fn initialize_state_foreign_function_summary(
    function_id: NodeId,
    semantic: &Semantic<'_>,
) -> Option<FxHashSet<usize>> {
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
    let mut parameter_indices = FxHashMap::default();
    for (parameter_index, parameter) in parameters.iter().enumerate() {
        let binding = parameter.pattern.get_binding_identifier()?;
        parameter_indices.insert(binding.symbol_id(), parameter_index);
    }
    let mut used_parameter_indices = FxHashSet::default();
    let mut visited_symbol_ids = Vec::new();
    if let Some(expression) = expression {
        return initialize_state_foreign_expression_is_pure(
            expression,
            function_id,
            semantic,
            &parameter_indices,
            &mut used_parameter_indices,
            &mut visited_symbol_ids,
        )
        .then_some(used_parameter_indices);
    }
    let can_continue = initialize_state_foreign_statements_can_continue(
        statements?,
        function_id,
        semantic,
        &parameter_indices,
        &mut used_parameter_indices,
        &mut visited_symbol_ids,
    )?;
    (!can_continue).then_some(used_parameter_indices)
}

fn initialize_state_foreign_statements_can_continue(
    statements: &[Statement<'_>],
    function_id: NodeId,
    semantic: &Semantic<'_>,
    parameter_indices: &FxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut FxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<bool> {
    let mut can_continue = true;
    for statement in statements {
        if !can_continue {
            if !matches!(statement, Statement::EmptyStatement(_)) {
                return None;
            }
            continue;
        }
        match statement {
            Statement::EmptyStatement(_) => {}
            Statement::VariableDeclaration(declaration) if declaration.kind.is_const() => {
                for declarator in &declaration.declarations {
                    declarator.id.get_binding_identifier()?;
                    if !initialize_state_foreign_expression_is_pure(
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
            Statement::ReturnStatement(statement) => {
                if !initialize_state_foreign_expression_is_pure(
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
            Statement::BlockStatement(block) => {
                can_continue = initialize_state_foreign_statements_can_continue(
                    &block.body,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                )?;
            }
            Statement::IfStatement(statement) => {
                if !initialize_state_foreign_expression_is_pure(
                    &statement.test,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                ) {
                    return None;
                }
                let consequent_can_continue = initialize_state_foreign_statements_can_continue(
                    std::slice::from_ref(&statement.consequent),
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                )?;
                let alternate_can_continue = if let Some(alternate) = &statement.alternate {
                    initialize_state_foreign_statements_can_continue(
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

fn initialize_state_foreign_expression_is_pure(
    expression: &Expression<'_>,
    function_id: NodeId,
    semantic: &Semantic<'_>,
    parameter_indices: &FxHashMap<SymbolId, usize>,
    used_parameter_indices: &mut FxHashSet<usize>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in semantic.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span())
            || initialize_state_foreign_nearest_function_id(candidate.id(), semantic)
                != Some(function_id)
        {
            continue;
        }
        match candidate.kind() {
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
                if !initialize_state_foreign_call_is_pure(call, semantic) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let reference = semantic.scoping().get_reference(identifier.reference_id());
                let Some(symbol_id) = reference.symbol_id() else {
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
                if let Some(parameter_index) = parameter_indices.get(&symbol_id) {
                    used_parameter_indices.insert(*parameter_index);
                    continue;
                }
                if visited_symbol_ids.contains(&symbol_id) {
                    return false;
                }
                let declaration = semantic.symbol_declaration(symbol_id);
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return false;
                };
                if !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                {
                    return false;
                }
                let Some(initializer) = &declarator.init else {
                    return false;
                };
                visited_symbol_ids.push(symbol_id);
                let is_pure = initialize_state_foreign_expression_is_pure(
                    initializer,
                    function_id,
                    semantic,
                    parameter_indices,
                    used_parameter_indices,
                    visited_symbol_ids,
                );
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

fn initialize_state_foreign_nearest_function_id(
    node_id: NodeId,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn initialize_state_foreign_call_is_pure(
    call: &oxc_ast::ast::CallExpression<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            INITIALIZE_STATE_PURE_GLOBAL_CALLS.contains(&identifier.name.as_str())
                && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                INITIALIZE_STATE_PURE_MEMBER_CALLS.contains(&property_name)
                    || initialize_state_foreign_is_pure_namespace_call(
                        member.object(),
                        property_name,
                        semantic,
                    )
                    || (property_name == "getTime"
                        && matches!(member.object().get_inner_expression(), Expression::NewExpression(construction)
                            if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                                if identifier.name == "Date"
                                    && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())))
            })
        }),
    }
}

fn initialize_state_foreign_is_pure_namespace_call(
    object: &Expression<'_>,
    property_name: &str,
    semantic: &Semantic<'_>,
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
    match identifier.name.as_str() {
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

fn initialize_state_is_pure_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            INITIALIZE_STATE_PURE_GLOBAL_CALLS.contains(&identifier.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|property_name| {
                INITIALIZE_STATE_PURE_MEMBER_CALLS.contains(&property_name)
                    || initialize_state_is_pure_namespace_call(member.object(), property_name, ctx)
            })
        }),
    }
}

fn initialize_state_is_pure_namespace_call<'a>(
    object: &Expression<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some()
    {
        return false;
    }
    match identifier.name.as_str() {
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
