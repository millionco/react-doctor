use oxc_ast::{
    AstKind as RenderPropAstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, Expression, ObjectPropertyKind, TSType,
        TSTypeName, TSTypeOperatorOperator,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This prop callback runs during render. React can replay or discard render work, so the callback can fire more than once or for UI that never commits.";
const RENDER_PROP_SYNCHRONOUS_CALLBACK_METHODS: [(&str, usize); 14] = [
    ("every", 0),
    ("filter", 0),
    ("find", 0),
    ("findIndex", 0),
    ("findLast", 0),
    ("findLastIndex", 0),
    ("flatMap", 0),
    ("forEach", 0),
    ("map", 0),
    ("reduce", 0),
    ("reduceRight", 0),
    ("replace", 1),
    ("replaceAll", 1),
    ("some", 0),
];

#[derive(Debug, Default, Clone)]
pub struct NoPropCallbackInRender;

declare_oxc_lint!(
    /// Disallows invoking prop callbacks during React render.
    NoPropCallbackInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prop callback invoked during render.",
);

impl Rule for NoPropCallbackInRender {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for call_node in ctx.nodes().iter() {
            let RenderPropAstKind::CallExpression(call) = call_node.kind() else {
                continue;
            };
            if !is_result_discarded_call(call_node, true, ctx)
                || render_prop_result_is_preserved(call_node, ctx)
            {
                continue;
            }
            let Some(owner) = render_prop_render_owner(call_node, ctx) else {
                continue;
            };
            let Some(owner_name) = component_or_hook_function_name(owner, ctx) else {
                continue;
            };
            if !crate::utils::is_react_hook_name(owner_name)
                && !function_has_react_component_evidence(owner, ctx)
                && !render_prop_function_has_component_use(owner, ctx)
            {
                continue;
            }
            if matches!(
                call.callee.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                continue;
            }
            if render_prop_callee_has_external_origin(
                &call.callee,
                owner.id(),
                call_node.span().start,
                ctx,
                &mut FxHashSet::default(),
            ) || render_prop_call_invokes_external_callback(
                call_node,
                owner.id(),
                call_node.span().start,
                ctx,
            ) {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call.span));
            }
        }
    }
}

fn render_prop_render_owner<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    find_render_phase_component_or_hook(node, ctx)
}

fn render_prop_result_is_preserved(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut node = call_node;
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        match parent.kind() {
            RenderPropAstKind::ParenthesizedExpression(_)
            | RenderPropAstKind::ChainExpression(_)
            | RenderPropAstKind::TSAsExpression(_)
            | RenderPropAstKind::TSSatisfiesExpression(_)
            | RenderPropAstKind::TSTypeAssertion(_)
            | RenderPropAstKind::TSNonNullExpression(_) => node = parent,
            RenderPropAstKind::LogicalExpression(expression)
                if expression.right.span() == node.span() =>
            {
                node = parent;
            }
            RenderPropAstKind::ConditionalExpression(expression)
                if expression.consequent.span() == node.span()
                    || expression.alternate.span() == node.span() =>
            {
                node = parent;
            }
            RenderPropAstKind::SequenceExpression(expression) => {
                if expression
                    .expressions
                    .last()
                    .is_none_or(|last| last.span() != node.span())
                {
                    return false;
                }
                node = parent;
            }
            RenderPropAstKind::ArrowFunctionExpression(function)
                if function
                    .get_expression()
                    .is_some_and(|body| body.span() == node.span()) =>
            {
                if !function_executes_during_render(parent, ctx) {
                    return true;
                }
                let invocation = ctx.nodes().parent_node(parent.id());
                let RenderPropAstKind::CallExpression(invocation_call) = invocation.kind() else {
                    return true;
                };
                let is_callback_argument = invocation_call
                    .arguments
                    .iter()
                    .take(2)
                    .any(|argument| argument.span() == parent.span());
                if is_callback_argument {
                    let is_for_each_callback = invocation_call
                        .arguments
                        .first()
                        .is_some_and(|argument| argument.span() == parent.span())
                        && invocation_call
                            .callee
                            .get_inner_expression()
                            .as_member_expression()
                            .is_some_and(|member| {
                                !member.is_computed()
                                    && member.static_property_name() == Some("forEach")
                            });
                    return !is_for_each_callback;
                }
                node = invocation;
            }
            _ => return !is_result_discarded_call(node, true, ctx),
        }
    }
}

fn render_prop_callee_has_external_origin<'a>(
    expression: &Expression<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        let Some(method_name) = member.static_property_name() else {
            return false;
        };
        if render_prop_expression_is_native_parameter_value(
            member.object(),
            render_owner_id,
            method_name,
            reference_offset,
            ctx,
        ) {
            return false;
        }
        if render_prop_is_handler_method_name(method_name) {
            return render_prop_expression_has_external_origin(
                member.object(),
                render_owner_id,
                reference_offset,
                ctx,
                visited_symbols,
            );
        }
        return render_prop_expression_is_whole_external_parameter(
            member.object(),
            render_owner_id,
            ctx,
        );
    }
    render_prop_expression_has_external_origin(
        expression,
        render_owner_id,
        reference_offset,
        ctx,
        visited_symbols,
    )
}

fn render_prop_call_invokes_external_callback<'a>(
    call_node: &AstNode<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
) -> bool {
    let RenderPropAstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let Some((_, callback_index)) = RENDER_PROP_SYNCHRONOUS_CALLBACK_METHODS
        .iter()
        .find(|(candidate, _)| *candidate == method_name)
    else {
        return false;
    };
    if !render_prop_expression_is_native_parameter_value(
        member.object(),
        render_owner_id,
        method_name,
        reference_offset,
        ctx,
    ) || !render_prop_expression_is_whole_external_parameter(
        member.object(),
        render_owner_id,
        ctx,
    ) {
        return false;
    }
    if render_prop_call_result_is_invoked(call_node, ctx) {
        return true;
    }
    let Some(callback) = call
        .arguments
        .get(*callback_index)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    render_prop_callback_is_unsafe(
        callback,
        render_owner_id,
        reference_offset,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn render_prop_expression_is_whole_external_parameter(
    expression: &Expression<'_>,
    render_owner_id: NodeId,
    ctx: &LintContext<'_>,
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
    let Some(parameter) = render_prop_parameter_binding(symbol_id, ctx) else {
        return false;
    };
    if !render_prop_parameter_is_whole(parameter, ctx) {
        return false;
    }
    let declaring_function = ctx.nodes().get_node(parameter.function_id);
    if render_prop_parameter_is_component_prop(declaring_function, ctx) {
        return true;
    }
    if parameter.function_id != render_owner_id {
        return false;
    }
    let owner = ctx.nodes().get_node(render_owner_id);
    if !component_or_hook_function_name(owner, ctx).is_some_and(crate::utils::is_react_hook_name) {
        return true;
    }
    render_prop_custom_hook_parameter_is_proven(
        parameter,
        None,
        render_owner_id,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn render_prop_call_result_is_invoked(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut result_node = call_node;
    loop {
        let parent = ctx.nodes().parent_node(result_node.id());
        match parent.kind() {
            RenderPropAstKind::ParenthesizedExpression(_)
            | RenderPropAstKind::ChainExpression(_)
            | RenderPropAstKind::TSAsExpression(_)
            | RenderPropAstKind::TSSatisfiesExpression(_)
            | RenderPropAstKind::TSTypeAssertion(_)
            | RenderPropAstKind::TSNonNullExpression(_) => result_node = parent,
            kind if kind
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == result_node.span()) =>
            {
                result_node = parent
            }
            RenderPropAstKind::CallExpression(call) if call.callee.span() == result_node.span() => {
                return true;
            }
            _ => return false,
        }
    }
}

fn render_prop_callback_is_unsafe<'a>(
    callback: &Expression<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    let callback = callback.get_inner_expression();
    let function_id = match callback {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            render_prop_callback_function_id(callback, ctx)
        }
        Expression::Identifier(_) => {
            if render_prop_expression_has_external_origin(
                callback,
                render_owner_id,
                reference_offset,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return true;
            }
            render_prop_callback_function_id(callback, ctx)
        }
        _ => return true,
    };
    let Some(function_id) = function_id else {
        return true;
    };
    if !visited_functions.insert(function_id) {
        return false;
    }
    render_prop_callback_invokes_parameter(function_id, ctx)
        || ctx.nodes().iter().any(|candidate| {
            if !matches!(candidate.kind(), RenderPropAstKind::CallExpression(_))
                || render_prop_nearest_function_id(candidate.id(), ctx) != Some(function_id)
            {
                return false;
            }
            let RenderPropAstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            render_prop_callee_has_external_origin(
                &call.callee,
                render_owner_id,
                candidate.span().start,
                ctx,
                &mut FxHashSet::default(),
            )
        })
}

fn render_prop_callback_function_id(
    callback: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    match callback.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => ctx
            .nodes()
            .iter()
            .find(|candidate| {
                candidate.span() == callback.get_inner_expression().span()
                    && matches!(
                        candidate.kind(),
                        RenderPropAstKind::Function(_)
                            | RenderPropAstKind::ArrowFunctionExpression(_)
                    )
            })
            .map(|candidate| candidate.id()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            if matches!(declaration.kind(), RenderPropAstKind::Function(_)) {
                return Some(declaration.id());
            }
            let RenderPropAstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            if let Expression::CallExpression(wrapper) = initializer
                && render_prop_callee_name(&wrapper.callee) == Some("useCallback")
            {
                return wrapper
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .and_then(|argument| render_prop_callback_function_id(argument, ctx));
            }
            render_prop_callback_function_id(initializer, ctx)
        }
        _ => None,
    }
}

fn render_prop_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    }
}

fn render_prop_callback_invokes_parameter(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function = ctx.nodes().get_node(function_id);
    let parameters = match function.kind() {
        RenderPropAstKind::Function(function) => &function.params.items,
        RenderPropAstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return false,
    };
    let mut parameter_names = FxHashSet::default();
    for parameter in parameters {
        collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
    }
    if parameter_names.is_empty() {
        return false;
    }
    loop {
        let previous_len = parameter_names.len();
        for candidate in ctx.nodes().iter() {
            if render_prop_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            match candidate.kind() {
                RenderPropAstKind::AssignmentExpression(assignment)
                    if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign =>
                {
                    let AssignmentTarget::AssignmentTargetIdentifier(target) = &assignment.left
                    else {
                        continue;
                    };
                    if render_prop_expression_root_identifier_name(&assignment.right)
                        .is_some_and(|name| parameter_names.contains(name))
                    {
                        parameter_names.insert(target.name.to_string());
                    }
                }
                RenderPropAstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| {
                        render_prop_expression_root_identifier_name(initializer)
                            .is_some_and(|name| parameter_names.contains(name))
                    }) =>
                {
                    collect_binding_pattern_names(&declarator.id, &mut parameter_names);
                }
                _ => {}
            }
        }
        if parameter_names.len() == previous_len {
            break;
        }
    }
    ctx.nodes().iter().any(|candidate| {
        let RenderPropAstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        render_prop_nearest_function_id(candidate.id(), ctx) == Some(function_id)
            && render_prop_expression_root_identifier_name(&call.callee)
                .is_some_and(|name| parameter_names.contains(name))
    })
}

fn render_prop_expression_root_identifier_name<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a str> {
    let mut current = expression.get_inner_expression();
    loop {
        match current {
            Expression::Identifier(identifier) => return Some(identifier.name.as_str()),
            expression if expression.as_member_expression().is_some() => {
                current = expression
                    .as_member_expression()?
                    .object()
                    .get_inner_expression();
            }
            _ => return None,
        }
    }
}

fn render_prop_expression_has_external_origin<'a>(
    expression: &Expression<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            render_prop_symbol_has_external_origin(
                symbol_id,
                render_owner_id,
                reference_offset,
                ctx,
                visited_symbols,
            )
        }
        _ => ctx.nodes().iter().any(|candidate| {
            if !expression.span().contains_inclusive(candidate.span()) {
                return false;
            }
            let RenderPropAstKind::IdentifierReference(identifier) = candidate.kind() else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            render_prop_symbol_has_external_origin(
                symbol_id,
                render_owner_id,
                reference_offset,
                ctx,
                &mut visited_symbols.clone(),
            )
        }),
    }
}

fn render_prop_expression_has_upstream_external_origin<'a>(
    expression: &Expression<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            render_prop_symbol_has_upstream_external_origin(
                symbol_id,
                render_owner_id,
                reference_offset,
                ctx,
                visited_symbols,
            )
        }
        _ => ctx.nodes().iter().any(|candidate| {
            if !expression.span().contains_inclusive(candidate.span()) {
                return false;
            }
            let RenderPropAstKind::IdentifierReference(identifier) = candidate.kind() else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            render_prop_symbol_has_upstream_external_origin(
                symbol_id,
                render_owner_id,
                reference_offset,
                ctx,
                &mut visited_symbols.clone(),
            )
        }),
    }
}

fn render_prop_symbol_has_external_origin<'a>(
    symbol_id: SymbolId,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    if let Some(parameter) = render_prop_parameter_binding(symbol_id, ctx) {
        let declaring_function = ctx.nodes().get_node(parameter.function_id);
        if render_prop_parameter_is_component_prop(declaring_function, ctx) {
            return true;
        }
        return render_prop_custom_hook_parameter_is_proven(
            parameter,
            None,
            render_owner_id,
            ctx,
            &mut FxHashSet::default(),
        );
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        RenderPropAstKind::VariableDeclarator(declarator) => {
            if let Some(initializer) = &declarator.init {
                if declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                {
                    if !render_prop_is_identifier_or_member_expression(initializer) {
                        return false;
                    }
                    return render_prop_expression_has_upstream_external_origin(
                        initializer,
                        render_owner_id,
                        reference_offset,
                        ctx,
                        visited_symbols,
                    );
                }
                if let BindingPattern::ObjectPattern(pattern) = &declarator.id
                    && pattern.properties.iter().any(|property| {
                        render_prop_binding_contains_symbol(&property.value, symbol_id)
                    })
                {
                    return render_prop_expression_has_upstream_external_origin(
                        initializer,
                        render_owner_id,
                        reference_offset,
                        ctx,
                        visited_symbols,
                    );
                }
                if let BindingPattern::ArrayPattern(pattern) = &declarator.id
                    && pattern
                        .elements
                        .iter()
                        .flatten()
                        .any(|element| render_prop_binding_contains_symbol(element, symbol_id))
                {
                    if !render_prop_is_identifier_or_member_expression(initializer) {
                        return false;
                    }
                    return render_prop_expression_has_upstream_external_origin(
                        initializer,
                        render_owner_id,
                        reference_offset,
                        ctx,
                        visited_symbols,
                    );
                }
            }
            false
        }
        _ => false,
    }
}

fn render_prop_symbol_has_upstream_external_origin<'a>(
    symbol_id: SymbolId,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    if let Some(parameter) = render_prop_parameter_binding(symbol_id, ctx) {
        let declaring_function = ctx.nodes().get_node(parameter.function_id);
        if render_prop_parameter_is_component_prop(declaring_function, ctx) {
            return true;
        }
        return render_prop_custom_hook_parameter_is_proven(
            parameter,
            None,
            render_owner_id,
            ctx,
            &mut FxHashSet::default(),
        );
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let RenderPropAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        || render_prop_binding_contains_symbol(&declarator.id, symbol_id)
    {
        return render_prop_expression_has_upstream_external_origin(
            initializer,
            render_owner_id,
            reference_offset,
            ctx,
            visited_symbols,
        );
    }
    false
}

fn render_prop_parameter_is_component_prop(function: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    if let RenderPropAstKind::Function(function) = function.kind()
        && function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration
    {
        return function.id.as_ref().is_some_and(|identifier| {
            identifier
                .name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
        });
    }
    let mut declaring_node = ctx.nodes().parent_node(function.id());
    while matches!(declaring_node.kind(), RenderPropAstKind::CallExpression(_)) {
        declaring_node = ctx.nodes().parent_node(declaring_node.id());
    }
    let RenderPropAstKind::VariableDeclarator(declarator) = declaring_node.kind() else {
        return false;
    };
    let Some(identifier) = declarator.id.get_binding_identifier() else {
        return false;
    };
    if !identifier
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    matches!(
        declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression),
        Some(Expression::ArrowFunctionExpression(_) | Expression::CallExpression(_))
    )
}

fn render_prop_is_identifier_or_member_expression(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    matches!(expression, Expression::Identifier(_)) || expression.as_member_expression().is_some()
}

#[derive(Clone, Copy)]
struct RenderPropParameterBinding {
    function_id: NodeId,
    parameter_index: usize,
    symbol_id: SymbolId,
}

fn render_prop_parameter_binding(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<RenderPropParameterBinding> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let function = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            RenderPropAstKind::Function(_) | RenderPropAstKind::ArrowFunctionExpression(_)
        )
    })?;
    let parameters = match function.kind() {
        RenderPropAstKind::Function(function) => &function.params.items,
        RenderPropAstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return None,
    };
    parameters
        .iter()
        .position(|parameter| render_prop_binding_contains_symbol(&parameter.pattern, symbol_id))
        .map(|parameter_index| RenderPropParameterBinding {
            function_id: function.id(),
            parameter_index,
            symbol_id,
        })
}

fn render_prop_parameter_is_whole(
    parameter: RenderPropParameterBinding,
    ctx: &LintContext<'_>,
) -> bool {
    let function = ctx.nodes().get_node(parameter.function_id);
    let pattern = match function.kind() {
        RenderPropAstKind::Function(function) => function
            .params
            .items
            .get(parameter.parameter_index)
            .map(|parameter| &parameter.pattern),
        RenderPropAstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .get(parameter.parameter_index)
            .map(|parameter| &parameter.pattern),
        _ => None,
    };
    pattern
        .and_then(BindingPattern::get_binding_identifier)
        .is_some_and(|binding| binding.symbol_id() == parameter.symbol_id)
}

fn render_prop_binding_contains_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            render_prop_binding_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern
                .properties
                .iter()
                .any(|property| render_prop_binding_contains_symbol(&property.value, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    render_prop_binding_contains_symbol(&rest.argument, symbol_id)
                })
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| render_prop_binding_contains_symbol(element, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    render_prop_binding_contains_symbol(&rest.argument, symbol_id)
                })
        }
    }
}

fn render_prop_custom_hook_parameter_is_proven(
    parameter: RenderPropParameterBinding,
    property_name: Option<&str>,
    render_owner_id: NodeId,
    ctx: &LintContext<'_>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    let function = ctx.nodes().get_node(parameter.function_id);
    let Some(function_name) = component_or_hook_function_name(function, ctx) else {
        return false;
    };
    if !crate::utils::is_react_hook_name(function_name)
        || !visited_functions.insert(parameter.function_id)
    {
        return false;
    }
    let Some(function_symbol_id) = render_prop_function_binding_symbol(function, ctx) else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(function_symbol_id)
        .collect::<Vec<_>>();
    if references.is_empty() && !render_prop_function_is_directly_exported(function, ctx) {
        return true;
    }
    references.iter().any(|reference| {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        let call_node = ctx.nodes().parent_node(reference_root.id());
        let RenderPropAstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        if call.callee.span() != reference_root.span() {
            return false;
        }
        let Some(argument) = call
            .arguments
            .get(parameter.parameter_index)
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        let argument =
            render_prop_argument_property_value(argument, parameter.symbol_id, property_name, ctx)
                .unwrap_or(argument);
        let Some(caller_id) = render_prop_nearest_function_id(call_node.id(), ctx) else {
            return false;
        };
        render_prop_expression_has_external_origin(
            argument,
            caller_id,
            call_node.span().start,
            ctx,
            &mut FxHashSet::default(),
        ) || (caller_id != render_owner_id
            && render_prop_expression_parameter_binding(argument, ctx).is_some_and(
                |caller_parameter| {
                    render_prop_custom_hook_parameter_is_proven(
                        caller_parameter,
                        None,
                        render_owner_id,
                        ctx,
                        visited_functions,
                    )
                },
            ))
    })
}

fn render_prop_argument_property_value<'a>(
    argument: &'a Expression<'a>,
    parameter_symbol_id: SymbolId,
    explicit_property_name: Option<&str>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(parameter_symbol_id);
    let property_name = explicit_property_name.map(str::to_string).or_else(|| {
        ctx.nodes()
            .ancestors(declaration.id())
            .find_map(|ancestor| match ancestor.kind() {
                RenderPropAstKind::BindingProperty(property)
                    if render_prop_binding_contains_symbol(
                        &property.value,
                        parameter_symbol_id,
                    ) =>
                {
                    property.key.static_name().map(|name| name.to_string())
                }
                RenderPropAstKind::FormalParameter(_) => None,
                _ => None,
            })
    })?;
    let mut candidate = argument.get_inner_expression();
    if let Expression::Identifier(identifier) = candidate
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let RenderPropAstKind::VariableDeclarator(declarator) =
            ctx.symbol_declaration(symbol_id).kind()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && let Some(initializer) = &declarator.init
    {
        candidate = initializer.get_inner_expression();
    }
    let Expression::ObjectExpression(object) = candidate else {
        return Some(argument);
    };
    object.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.key.static_name().as_deref() == Some(property_name.as_str()))
            .then_some(&property.value)
    })
}

fn render_prop_expression_parameter_binding(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<RenderPropParameterBinding> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    render_prop_parameter_binding(symbol_id, ctx)
}

fn render_prop_expression_is_native_parameter_value(
    expression: &Expression<'_>,
    render_owner_id: NodeId,
    method_name: &str,
    reference_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    if render_prop_is_handler_method_name(method_name) {
        return false;
    }
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
    if render_prop_symbol_or_member_was_written_before(
        symbol_id,
        method_name,
        render_owner_id,
        reference_offset,
        ctx,
    ) {
        return false;
    }
    if let Some(parameter) = render_prop_parameter_binding(symbol_id, ctx) {
        if parameter.function_id != render_owner_id {
            return false;
        }
        let is_hook = component_or_hook_function_name(ctx.nodes().get_node(render_owner_id), ctx)
            .is_some_and(crate::utils::is_react_hook_name);
        return if is_hook {
            render_prop_parameter_has_native_type(parameter, method_name, ctx)
        } else {
            !render_prop_parameter_is_whole(parameter, ctx)
        };
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let RenderPropAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(ctx.nodes().parent_kind(declaration.id()), RenderPropAstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return false;
    }
    if let BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern
            .properties
            .iter()
            .any(|property| render_prop_binding_contains_symbol(&property.value, symbol_id))
        && let Some(Expression::Identifier(receiver)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        && let Some(receiver_symbol_id) = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
        && let Some(parameter) = render_prop_parameter_binding(receiver_symbol_id, ctx)
        && parameter.function_id == render_owner_id
        && render_prop_parameter_is_whole(parameter, ctx)
    {
        return true;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        render_prop_expression_is_native_parameter_value(
            initializer,
            render_owner_id,
            method_name,
            reference_offset,
            ctx,
        )
    })
}

fn render_prop_symbol_or_member_was_written_before(
    symbol_id: SymbolId,
    method_name: &str,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let write_node = ctx.nodes().get_node(reference.node_id());
            write_node.span().start < reference_offset
                && render_prop_write_executes_in_owner(
                    write_node,
                    render_owner_id,
                    reference_offset,
                    ctx,
                )
        })
    {
        return true;
    }
    ctx.nodes().iter().any(|node| {
        if node.span().start >= reference_offset {
            return false;
        }
        let RenderPropAstKind::AssignmentExpression(assignment) = node.kind() else {
            return false;
        };
        let Some(member) = assignment.left.as_member_expression() else {
            return false;
        };
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return false;
        };
        ctx.scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            == Some(symbol_id)
            && (member.static_property_name() == Some(method_name)
                || member.static_property_name().is_none())
            && render_prop_write_executes_in_owner(node, render_owner_id, reference_offset, ctx)
    })
}

fn render_prop_write_executes_in_owner<'a>(
    write_node: &AstNode<'a>,
    render_owner_id: NodeId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(write_function) = crate::ast_util::get_enclosing_function(write_node, ctx) else {
        return false;
    };
    if write_function.id() == render_owner_id {
        return true;
    }
    let Some(function_symbol_id) = render_prop_function_binding_symbol(write_function, ctx) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(function_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            parent.span().start < reference_offset
                && matches!(parent.kind(), RenderPropAstKind::CallExpression(call) if call.callee.span() == root.span())
                && render_prop_nearest_function_id(parent.id(), ctx) == Some(render_owner_id)
        })
}

fn render_prop_parameter_has_native_type(
    parameter: RenderPropParameterBinding,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let function = ctx.nodes().get_node(parameter.function_id);
    let parameter_node = match function.kind() {
        RenderPropAstKind::Function(function) => {
            function.params.items.get(parameter.parameter_index)
        }
        RenderPropAstKind::ArrowFunctionExpression(function) => {
            function.params.items.get(parameter.parameter_index)
        }
        _ => None,
    };
    let Some(annotation) = parameter_node.and_then(|parameter| parameter.type_annotation.as_ref())
    else {
        return false;
    };
    render_prop_type_has_native_read_method(&annotation.type_annotation, method_name, ctx)
}

fn render_prop_type_has_native_read_method(
    type_node: &TSType<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    match type_node {
        TSType::TSArrayType(_) | TSType::TSTupleType(_) => {
            render_prop_array_has_read_method(method_name)
        }
        TSType::TSStringKeyword(_) => render_prop_string_has_read_method(method_name),
        TSType::TSFunctionType(_) => method_name == "bind",
        TSType::TSLiteralType(literal)
            if matches!(&literal.literal, oxc_ast::ast::TSLiteral::StringLiteral(_)) =>
        {
            render_prop_string_has_read_method(method_name)
        }
        TSType::TSTypeOperatorType(operator)
            if operator.operator == TSTypeOperatorOperator::Readonly =>
        {
            render_prop_type_has_native_read_method(&operator.type_annotation, method_name, ctx)
        }
        TSType::TSUnionType(union) => {
            let mut has_non_nullish_member = false;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                ) {
                    continue;
                }
                has_non_nullish_member = true;
                if !render_prop_type_has_native_read_method(member, method_name, ctx) {
                    return false;
                }
            }
            has_non_nullish_member
        }
        TSType::TSTypeReference(reference) => {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
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
                "Array" | "ReadonlyArray" => render_prop_array_has_read_method(method_name),
                "Map" | "ReadonlyMap" => matches!(
                    method_name,
                    "entries" | "forEach" | "get" | "has" | "keys" | "values"
                ),
                "Set" | "ReadonlySet" => matches!(
                    method_name,
                    "difference"
                        | "entries"
                        | "forEach"
                        | "has"
                        | "intersection"
                        | "isDisjointFrom"
                        | "isSubsetOf"
                        | "isSupersetOf"
                        | "keys"
                        | "symmetricDifference"
                        | "union"
                        | "values"
                ),
                "Promise" | "PromiseLike" => matches!(method_name, "catch" | "finally" | "then"),
                _ => false,
            }
        }
        _ => false,
    }
}

fn render_prop_array_has_read_method(method_name: &str) -> bool {
    matches!(
        method_name,
        "at" | "concat"
            | "entries"
            | "every"
            | "filter"
            | "find"
            | "findIndex"
            | "findLast"
            | "findLastIndex"
            | "flat"
            | "flatMap"
            | "forEach"
            | "includes"
            | "indexOf"
            | "join"
            | "keys"
            | "lastIndexOf"
            | "map"
            | "reduce"
            | "reduceRight"
            | "slice"
            | "some"
            | "toLocaleString"
            | "toReversed"
            | "toSorted"
            | "toSpliced"
            | "toString"
            | "values"
            | "with"
    )
}

fn render_prop_string_has_read_method(method_name: &str) -> bool {
    matches!(
        method_name,
        "at" | "charAt"
            | "charCodeAt"
            | "codePointAt"
            | "concat"
            | "endsWith"
            | "includes"
            | "indexOf"
            | "isWellFormed"
            | "lastIndexOf"
            | "localeCompare"
            | "match"
            | "matchAll"
            | "normalize"
            | "padEnd"
            | "padStart"
            | "repeat"
            | "replace"
            | "replaceAll"
            | "search"
            | "slice"
            | "split"
            | "startsWith"
            | "substring"
            | "toLocaleLowerCase"
            | "toLocaleUpperCase"
            | "toLowerCase"
            | "toString"
            | "toUpperCase"
            | "toWellFormed"
            | "trim"
            | "trimEnd"
            | "trimStart"
            | "valueOf"
    )
}

fn render_prop_is_handler_method_name(method_name: &str) -> bool {
    let suffix = method_name
        .strip_prefix("on")
        .or_else(|| method_name.strip_prefix("handle"));
    suffix
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|character| character.is_ascii_uppercase())
}

fn render_prop_function_binding_symbol<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let RenderPropAstKind::Function(function) = function.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let root = transparent_expression_root(function, ctx);
    let mut parent = ctx.nodes().parent_node(root.id());
    let mut expression_root = root;
    while let RenderPropAstKind::CallExpression(call) = parent.kind() {
        if call
            .arguments
            .first()
            .is_none_or(|argument| argument.span() != expression_root.span())
            || !render_prop_is_component_wrapper_call(call, ctx)
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
        parent = ctx.nodes().parent_node(expression_root.id());
    }
    let RenderPropAstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn render_prop_is_component_wrapper_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_api_call(call, "memo", ctx) || is_react_api_call(call, "forwardRef", ctx) {
        return true;
    }
    call.callee_name()
        .is_some_and(|name| matches!(name, "observer" | "lazy"))
}

fn render_prop_function_is_directly_exported<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(symbol_id) = render_prop_function_binding_symbol(function, ctx)
        && ctx
            .scoping()
            .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
            .is_top()
    {
        let symbol_name = ctx.scoping().symbol_name(symbol_id);
        if ctx
            .module_record()
            .local_export_entries
            .iter()
            .any(|entry| !entry.is_type && entry.local_name.name() == Some(symbol_name))
        {
            return true;
        }
    }
    ctx.nodes()
        .ancestors(function.id())
        .take_while(|ancestor| !matches!(ancestor.kind(), RenderPropAstKind::Program(_)))
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                RenderPropAstKind::ExportNamedDeclaration(_)
                    | RenderPropAstKind::ExportDefaultDeclaration(_)
            )
        })
        || ctx.nodes().iter().any(|candidate| {
            matches!(
                candidate.kind(),
                RenderPropAstKind::ExportNamedDeclaration(_)
                    | RenderPropAstKind::ExportDefaultDeclaration(_)
            ) && candidate.span().contains_inclusive(function.span())
        })
}

fn render_prop_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            RenderPropAstKind::Function(_) | RenderPropAstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn render_prop_function_has_component_use<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = render_prop_function_binding_symbol(function, ctx) else {
        return false;
    };
    render_prop_symbol_has_component_use(symbol_id, ctx, &mut FxHashSet::default())
}

fn render_prop_symbol_has_component_use(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if symbol_has_write_before(symbol_id, reference_node.span().start, ctx) {
                return false;
            }
            let root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            if matches!(parent.kind(), RenderPropAstKind::JSXOpeningElement(_)) {
                return true;
            }
            if let RenderPropAstKind::CallExpression(call) = parent.kind()
                && call
                    .arguments
                    .first()
                    .is_some_and(|argument| argument.span() == root.span())
                && is_react_api_call(call, "createElement", ctx)
            {
                return true;
            }
            let RenderPropAstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            let Some(alias) = declarator.id.get_binding_identifier() else {
                return false;
            };
            declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == root.span())
                && matches!(ctx.nodes().parent_kind(parent.id()), RenderPropAstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && render_prop_symbol_has_component_use(alias.symbol_id(), ctx, visited)
        })
}
