use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const HOOK_NAMES: [&str; 3] = ["useMemo", "useCallback", "useImperativeHandle"];
const CALLBACK_CONSUMER_NAMES: [&str; 27] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
    "toSorted",
    "addEventListener",
    "addListener",
    "catch",
    "finally",
    "once",
    "queueMicrotask",
    "register",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "subscribe",
    "then",
];

#[derive(Clone, Copy, Default)]
struct DependencyUsage {
    has_bare_use: bool,
    has_member_read: bool,
}

#[derive(Debug, Default, Clone)]
pub struct NoWholeObjectDepWithMemberReads;

declare_oxc_lint!(
    /// Warns when a memo hook depends on an entire props object while reading only members.
    NoWholeObjectDepWithMemberReads,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer specific props members over a whole-object dependency.",
);

impl Rule for NoWholeObjectDepWithMemberReads {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut member_bindings_by_props = FxHashMap::<SymbolId, FxHashSet<SymbolId>>::default();
        let mut usage_by_callback_and_props =
            FxHashMap::<(NodeId, SymbolId), DependencyUsage>::default();

        for hook_node in ctx.nodes().iter() {
            let AstKind::CallExpression(hook_call) = hook_node.kind() else {
                continue;
            };
            let Some(hook_name) = HOOK_NAMES
                .iter()
                .find(|hook_name| is_react_api_call(hook_call, hook_name, ctx))
            else {
                continue;
            };
            let callback_index = usize::from(*hook_name == "useImperativeHandle");
            let Some(callback_expression) = hook_call
                .arguments
                .get(callback_index)
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_whole_dep_callback(callback_expression, ctx) else {
                continue;
            };
            let Some(dependency_array) = hook_call
                .arguments
                .get(callback_index + 1)
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression)
                .and_then(|expression| match expression {
                    Expression::ArrayExpression(array) => Some(array),
                    _ => None,
                })
            else {
                continue;
            };
            let Some(component_id) = enclosing_uppercase_component_id(hook_node.id(), ctx) else {
                continue;
            };
            let Some(props_symbol_id) = component_props_symbol_id(component_id, ctx) else {
                continue;
            };
            let member_binding_symbol_ids = member_bindings_by_props
                .entry(props_symbol_id)
                .or_insert_with(|| collect_props_member_binding_symbols(props_symbol_id, ctx));
            let usage = *usage_by_callback_and_props
                .entry((callback_id, props_symbol_id))
                .or_insert_with(|| {
                    analyze_props_usage(
                        callback_id,
                        props_symbol_id,
                        member_binding_symbol_ids,
                        ctx,
                    )
                });
            if usage.has_bare_use || !usage.has_member_read {
                continue;
            }
            for element in &dependency_array.elements {
                let Some(expression) = element.as_expression() else {
                    continue;
                };
                let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                    continue;
                };
                if resolve_const_identifier_root_symbol(identifier, ctx) != Some(props_symbol_id) {
                    continue;
                }
                let message = format!(
                    "This hook depends on the whole \"{}\" object but only reads its properties; depend on the specific fields instead.",
                    identifier.name
                );
                ctx.diagnostic(OxcDiagnostic::warn(message).with_label(element.span()));
            }
        }
    }
}

fn enclosing_uppercase_component_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    let function = ctx.nodes().ancestors(node_id).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })?;
    component_or_hook_function_name(function, ctx)
        .is_some_and(|name| {
            name.chars()
                .next()
                .is_some_and(|character| character.is_uppercase())
        })
        .then_some(function.id())
}

fn component_props_symbol_id(component_id: NodeId, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let pattern = match ctx.nodes().get_node(component_id).kind() {
        AstKind::Function(function) => &function.params.items.first()?.pattern,
        AstKind::ArrowFunctionExpression(function) => &function.params.items.first()?.pattern,
        _ => return None,
    };
    direct_pattern_binding_identifier(pattern).map(|identifier| identifier.symbol_id())
}

fn direct_pattern_binding_identifier<'a>(
    pattern: &'a BindingPattern<'a>,
) -> Option<&'a oxc_ast::ast::BindingIdentifier<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier),
        BindingPattern::AssignmentPattern(assignment) => {
            direct_pattern_binding_identifier(&assignment.left)
        }
        _ => None,
    }
}

fn collect_props_member_binding_symbols(
    props_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut member_binding_symbol_ids = FxHashSet::default();
    let mut pending_symbol_ids = vec![props_symbol_id];
    let mut visited_symbol_ids = FxHashSet::default();
    while let Some(source_symbol_id) = pending_symbol_ids.pop() {
        if !visited_symbol_ids.insert(source_symbol_id) {
            continue;
        }
        for reference in ctx.scoping().get_resolved_references(source_symbol_id) {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(identifier_node.id());
            if let Some(member) = parent.kind().as_member_expression_kind()
                && member.object().span() == identifier_node.span()
            {
                if member.static_property_name().is_none()
                    || member_expression_is_mutation(parent, ctx)
                {
                    continue;
                }
                let expression_root = transparent_expression_root(parent, ctx);
                let declarator_node = ctx.nodes().parent_node(expression_root.id());
                if let AstKind::VariableDeclarator(declarator) = declarator_node.kind()
                    && declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == expression_root.span())
                {
                    collect_static_pattern_binding_symbols(
                        &declarator.id,
                        &mut member_binding_symbol_ids,
                    );
                }
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != identifier_node.span())
            {
                continue;
            }
            if let BindingPattern::BindingIdentifier(alias) = &declarator.id {
                if variable_declarator_is_const(parent, ctx)
                    && const_binding_root_symbol(alias.symbol_id(), ctx) == Some(props_symbol_id)
                {
                    pending_symbol_ids.push(alias.symbol_id());
                }
                continue;
            }
            collect_static_pattern_binding_symbols(&declarator.id, &mut member_binding_symbol_ids);
        }
    }
    member_binding_symbol_ids
}

fn collect_static_pattern_binding_symbols(
    pattern: &BindingPattern<'_>,
    symbols: &mut FxHashSet<SymbolId>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            symbols.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_static_pattern_binding_symbols(&assignment.left, symbols);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                if !property.computed {
                    collect_static_pattern_binding_symbols(&property.value, symbols);
                }
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                collect_static_pattern_binding_symbols(element, symbols);
            }
        }
    }
}

fn variable_declarator_is_const(declarator_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(ctx.nodes().parent_node(declarator_node.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
}

fn const_binding_root_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
    };
    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
        return Some(symbol_id);
    };
    if !variable_declarator_is_const(declaration, ctx) {
        return Some(symbol_id);
    }
    let Expression::Identifier(identifier) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return Some(symbol_id);
    };
    let root = resolve_const_identifier_root_symbol(identifier, ctx)?;
    (binding.symbol_id() == symbol_id).then_some(root)
}

fn member_expression_is_mutation<'a>(
    member_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression_root = transparent_expression_root(member_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let Some(parent_member) = parent.kind().as_member_expression_kind() else {
            break;
        };
        if parent_member.object().span() != expression_root.span() {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::AssignmentExpression(assignment) => {
            assignment.left.span() == expression_root.span()
        }
        AstKind::UpdateExpression(update) => update.argument.span() == expression_root.span(),
        AstKind::UnaryExpression(unary) => {
            unary.operator == UnaryOperator::Delete
                && unary.argument.span() == expression_root.span()
        }
        AstKind::ForInStatement(statement) => statement.left.span() == expression_root.span(),
        AstKind::ForOfStatement(statement) => statement.left.span() == expression_root.span(),
        _ => false,
    }
}

fn analyze_props_usage(
    callback_id: NodeId,
    props_symbol_id: SymbolId,
    member_binding_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> DependencyUsage {
    let mut usage = DependencyUsage::default();
    let mut pending_function_ids = vec![callback_id];
    let mut visited_function_ids = FxHashSet::default();
    while let Some(function_id) = pending_function_ids.pop() {
        if !visited_function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if candidate.id() != function_id
                && local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id)
            {
                continue;
            }
            if candidate.id() != function_id
                && matches!(
                    candidate.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            {
                if nested_function_escapes_return(candidate, function_id, ctx) {
                    pending_function_ids.push(candidate.id());
                }
                continue;
            }
            match candidate.kind() {
                AstKind::CallExpression(call) => {
                    if let Some(called_function_id) = resolve_whole_dep_callback(&call.callee, ctx)
                        && called_function_id != function_id
                    {
                        pending_function_ids.push(called_function_id);
                    }
                    if call_consumes_or_escapes_callback(call) {
                        for argument in &call.arguments {
                            if let Some(expression) = argument.as_expression()
                                && let Some(argument_function_id) =
                                    resolve_whole_dep_callback(expression, ctx)
                            {
                                pending_function_ids.push(argument_function_id);
                            }
                        }
                    }
                }
                AstKind::NewExpression(construction) => {
                    if new_expression_is_global_promise(construction, ctx)
                        && let Some(executor) = construction
                            .arguments
                            .first()
                            .and_then(Argument::as_expression)
                        && let Some(executor_id) = resolve_whole_dep_callback(executor, ctx)
                    {
                        pending_function_ids.push(executor_id);
                    }
                }
                AstKind::ReturnStatement(statement) => {
                    if let Some(returned) = &statement.argument
                        && let Some(returned_id) = resolve_whole_dep_callback(returned, ctx)
                    {
                        pending_function_ids.push(returned_id);
                    }
                }
                AstKind::IdentifierReference(identifier) => analyze_props_identifier(
                    candidate,
                    identifier,
                    props_symbol_id,
                    member_binding_symbol_ids,
                    &mut usage,
                    ctx,
                ),
                _ => {}
            }
        }
    }
    usage
}

fn analyze_props_identifier<'a>(
    identifier_node: &AstNode<'a>,
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    props_symbol_id: SymbolId,
    member_binding_symbol_ids: &FxHashSet<SymbolId>,
    usage: &mut DependencyUsage,
    ctx: &LintContext<'a>,
) {
    let direct_symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id();
    if direct_symbol_id.is_some_and(|symbol_id| member_binding_symbol_ids.contains(&symbol_id))
        || resolve_const_identifier_root_symbol(identifier, ctx)
            .is_some_and(|symbol_id| member_binding_symbol_ids.contains(&symbol_id))
    {
        usage.has_member_read = true;
        return;
    }
    if resolve_const_identifier_root_symbol(identifier, ctx) != Some(props_symbol_id) {
        return;
    }
    let parent = ctx.nodes().parent_node(identifier_node.id());
    if let Some(member) = parent.kind().as_member_expression_kind() {
        if matches!(parent.kind(), AstKind::StaticMemberExpression(member)
            if member.property.span == identifier_node.span())
        {
            return;
        }
        if member.object().span() == identifier_node.span() {
            let expression_root = transparent_expression_root(parent, ctx);
            let parent_of_member = ctx.nodes().parent_node(expression_root.id());
            let is_direct_method_receiver = matches!(parent_of_member.kind(), AstKind::CallExpression(call)
            if call.callee.span() == expression_root.span()
                && !member.static_property_name().is_some_and(|name| {
                    let name = name.as_bytes();
                    name.starts_with(b"on") && name.get(2).is_some_and(u8::is_ascii_uppercase)
                }));
            if member.static_property_name().is_none()
                || member_expression_is_mutation(parent, ctx)
                || is_direct_method_receiver
            {
                usage.has_bare_use = true;
            } else {
                usage.has_member_read = true;
            }
            return;
        }
    }
    if matches!(parent.kind(), AstKind::ObjectProperty(property)
        if property.key.span() == identifier_node.span() && !property.computed && !property.shorthand)
    {
        return;
    }
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == identifier_node.span())
    {
        if matches!(&declarator.id, BindingPattern::BindingIdentifier(_))
            && variable_declarator_is_const(parent, ctx)
        {
            return;
        }
        if count_static_destructure_reads(&declarator.id).is_some() {
            usage.has_member_read = true;
            return;
        }
    }
    usage.has_bare_use = true;
}

fn count_static_destructure_reads(pattern: &BindingPattern<'_>) -> Option<usize> {
    match pattern {
        BindingPattern::BindingIdentifier(_) => Some(1),
        BindingPattern::AssignmentPattern(assignment) => {
            count_static_destructure_reads(&assignment.left)
        }
        BindingPattern::ObjectPattern(object) => {
            if object.properties.is_empty() || object.rest.is_some() {
                return None;
            }
            let mut count = 0;
            for property in &object.properties {
                if property.computed {
                    return None;
                }
                count += count_static_destructure_reads(&property.value)?;
            }
            (count > 0).then_some(count)
        }
        BindingPattern::ArrayPattern(array) => {
            if array.elements.is_empty() || array.rest.is_some() {
                return None;
            }
            let mut count = 0;
            for element in array.elements.iter().flatten() {
                count += count_static_destructure_reads(element)?;
            }
            (count > 0).then_some(count)
        }
    }
}

fn resolve_whole_dep_callback<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            function_id_for_symbol(symbol_id, ctx)
        }
        expression => {
            let member = expression.as_member_expression()?;
            let method_name = member.static_property_name()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            let receiver_symbol_id = ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(receiver_symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let Expression::ObjectExpression(object) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            object.properties.iter().rev().find_map(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.key.static_name().as_deref() != Some(method_name) {
                    return None;
                }
                match property.value.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    _ => None,
                }
            })
        }
    }
}

fn function_id_for_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<NodeId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn call_consumes_or_escapes_callback(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::Identifier(identifier) => {
            CALLBACK_CONSUMER_NAMES.contains(&identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .is_some_and(|name| CALLBACK_CONSUMER_NAMES.contains(&name)),
    }
}

fn new_expression_is_global_promise(
    construction: &oxc_ast::ast::NewExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "Promise"
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn nested_function_escapes_return(
    function_node: &AstNode<'_>,
    current_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = ctx.nodes().parent_node(function_node.id());
    loop {
        if current.id() == current_function_id {
            return matches!(current.kind(), AstKind::ArrowFunctionExpression(function)
                if function.get_expression().is_some_and(|body| body.span().contains_inclusive(function_node.span())));
        }
        if matches!(current.kind(), AstKind::ReturnStatement(_)) {
            return true;
        }
        if matches!(
            current.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        current = ctx.nodes().parent_node(current.id());
    }
}
