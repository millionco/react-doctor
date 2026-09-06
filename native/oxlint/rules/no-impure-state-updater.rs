use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, BindingPattern, Expression, IdentifierReference, MemberExpression,
        SimpleAssignmentTarget,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::node::NodeId;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
};

const TIMER_FUNCTION_NAMES: [&str; 7] = [
    "cancelAnimationFrame",
    "clearInterval",
    "clearTimeout",
    "queueMicrotask",
    "requestAnimationFrame",
    "setInterval",
    "setTimeout",
];
const STORAGE_MUTATION_METHOD_NAMES: [&str; 3] = ["clear", "removeItem", "setItem"];
const STORAGE_RECEIVER_NAMES: [&str; 2] = ["localStorage", "sessionStorage"];
const EXTERNAL_READ_METHOD_NAMES: [&str; 2] = ["getBoundingClientRect", "getClientRects"];
const NOTIFICATION_RECEIVER_NAMES: [&str; 3] = ["message", "notification", "toast"];
const NOTIFICATION_METHOD_NAMES: [&str; 7] = [
    "error", "info", "loading", "open", "show", "success", "warning",
];
const NOTIFICATION_MODULE_SOURCES: [&str; 7] = [
    "@chakra-ui/react",
    "@heroui/react",
    "@mantine/notifications",
    "antd",
    "react-hot-toast",
    "react-toastify",
    "sonner",
];
const SYNCHRONOUS_ARRAY_METHOD_NAMES: [&str; 11] = [
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
    "sort",
];

#[derive(Debug, Default, Clone)]
pub struct NoImpureStateUpdater;

declare_oxc_lint!(
    /// Disallow side effects inside useState updater callbacks.
    NoImpureStateUpdater,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow side effects inside state updater callbacks.",
);

#[derive(Clone, Copy)]
struct UpdaterFunction {
    node_id: NodeId,
    span: Span,
    params_span: Span,
}

impl Rule for NoImpureStateUpdater {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
            return;
        };
        let Some(updater_argument) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if !matches!(
            updater_argument.get_inner_expression(),
            Expression::ArrowFunctionExpression(_)
                | Expression::FunctionExpression(_)
                | Expression::Identifier(_)
        ) || !identifier_is_state_setter_or_wrapper(callee, ctx, &mut Vec::new())
        {
            return;
        }
        let Some(updater) = resolve_updater_function(updater_argument, ctx, &mut Vec::new()) else {
            return;
        };
        let Some(operation) = find_impure_updater_operation(updater, ctx) else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "This state updater performs {operation}. React may run updater functions more than once, so side effects here can repeat or observe inconsistent external state."
            ))
            .with_label(updater_argument.span()),
        );
    }
}

fn identifier_is_state_setter_or_wrapper(
    identifier: &IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    symbol_is_state_setter_or_wrapper(symbol_id, ctx, visited_symbol_ids)
}

fn symbol_is_state_setter_or_wrapper(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if symbol_is_state_setter(symbol_id, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    if let Some(alias_symbol_id) = const_identifier_alias_symbol_id(symbol_id, ctx) {
        return symbol_is_state_setter_or_wrapper(alias_symbol_id, ctx, visited_symbol_ids);
    }
    let Some(wrapper) = function_for_symbol(symbol_id, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if !wrapper.span.contains_inclusive(candidate.span()) {
            return false;
        }
        let Expression::Identifier(called_identifier) = call_expression.callee.get_inner_expression()
        else {
            return false;
        };
        let Some(called_symbol_id) = ctx
            .scoping()
            .get_reference(called_identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        symbol_is_state_setter_or_wrapper(called_symbol_id, ctx, visited_symbol_ids)
    })
}

fn const_identifier_alias_symbol_id(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let binding = declarator.id.get_binding_identifier()?;
    if binding.symbol_id() != symbol_id
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
        )
    {
        return None;
    }
    let Expression::Identifier(alias) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(alias.reference_id())
        .symbol_id()
}

fn symbol_is_state_setter(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(setter_identifier)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return false;
    };
    let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
        return false;
    };
    setter_identifier.symbol_id() == symbol_id
        && is_react_hook_call(use_state_call, &["useState"], ctx)
}

fn function_for_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> Option<UpdaterFunction> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(UpdaterFunction {
            node_id: function.node_id.get(),
            span: function.span(),
            params_span: function.params.span,
        }),
        AstKind::VariableDeclarator(declarator) => {
            let binding = declarator.id.get_binding_identifier()?;
            if binding.symbol_id() != symbol_id {
                return None;
            }
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return None;
            }
            function_from_expression(declarator.init.as_ref()?.get_inner_expression())
        }
        _ => None,
    }
}

fn function_from_expression(expression: &Expression<'_>) -> Option<UpdaterFunction> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(UpdaterFunction {
            node_id: function.node_id.get(),
            span: function.span,
            params_span: function.params.span,
        }),
        Expression::FunctionExpression(function) => Some(UpdaterFunction {
            node_id: function.node_id.get(),
            span: function.span,
            params_span: function.params.span,
        }),
        _ => None,
    }
}

fn resolve_updater_function(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<UpdaterFunction> {
    if let Some(function) = function_from_expression(expression) {
        return Some(function);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    if let Some(function) = function_for_symbol(symbol_id, ctx) {
        return Some(function);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    resolve_updater_function(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn find_impure_updater_operation(
    updater: UpdaterFunction,
    ctx: &LintContext<'_>,
) -> Option<String> {
    for candidate in ctx.nodes().iter() {
        if !updater.span.contains_inclusive(candidate.span())
            || !candidate_executes_in_updater(candidate, updater.node_id, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression) => {
                if let Expression::Identifier(callee) = call_expression.callee.get_inner_expression()
                    && identifier_is_state_setter_or_wrapper(callee, ctx, &mut Vec::new())
                {
                    return Some(format!("the nested state update \"{}()\"", callee.name));
                }
                if let Some(operation) = known_impure_call(call_expression, ctx) {
                    return Some(operation);
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if let Some(root_identifier) = assignment_target_root_identifier(&assignment.left)
                    && let Some(description) = external_assignment_description(
                        root_identifier,
                        updater,
                        ctx,
                    )
                {
                    return Some(description);
                }
            }
            AstKind::UpdateExpression(update) => {
                if let Some(root_identifier) =
                    simple_assignment_target_root_identifier(&update.argument)
                    && let Some(description) = external_assignment_description(
                        root_identifier,
                        updater,
                        ctx,
                    )
                {
                    return Some(description);
                }
            }
            _ => {}
        }
    }
    None
}

fn candidate_executes_in_updater(
    candidate: &AstNode<'_>,
    updater_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if ancestor.id() == updater_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !is_definitely_synchronous_callback(ancestor, ctx)
        {
            return false;
        }
    }
    false
}

fn is_definitely_synchronous_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if call_expression.callee.span() == function_root.span() {
        return true;
    }
    let callback_argument_index = call_expression.arguments.iter().position(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_root.span())
    });
    let Some(callback_argument_index) = callback_argument_index else {
        return false;
    };
    let Some(static_member) = static_member_expression(&call_expression.callee) else {
        return false;
    };
    if static_member.property.name == "from"
        && callback_argument_index == 1
        && is_unresolved_identifier_named(&static_member.object, "Array", ctx)
    {
        return true;
    }
    SYNCHRONOUS_ARRAY_METHOD_NAMES.contains(&static_member.property.name.as_str())
        && is_array_value(&static_member.object, ctx)
}

fn is_array_value<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::Identifier(identifier) => resolve_direct_unreassigned_initializer(identifier, ctx)
            .is_some_and(|initializer| {
                matches!(initializer.get_inner_expression(), Expression::ArrayExpression(_))
            }),
        _ => false,
    }
}

fn known_impure_call<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if let Expression::Identifier(callee) = call_expression.callee.get_inner_expression()
        && TIMER_FUNCTION_NAMES.contains(&callee.name.as_str())
        && is_unresolved_identifier(callee, ctx)
    {
        return Some(format!("{}()", callee.name));
    }
    let static_member = static_member_expression(&call_expression.callee)?;
    let method_name = static_member.property.name.as_str();
    if TIMER_FUNCTION_NAMES.contains(&method_name)
        && (is_unresolved_identifier_named(&static_member.object, "window", ctx)
            || is_unresolved_identifier_named(&static_member.object, "globalThis", ctx))
    {
        return Some(format!("{method_name}()"));
    }
    if STORAGE_MUTATION_METHOD_NAMES.contains(&method_name)
        && is_storage_receiver(&static_member.object, ctx)
    {
        return Some(format!("{method_name}()"));
    }
    if EXTERNAL_READ_METHOD_NAMES.contains(&method_name)
        && (has_react_ref_current_origin(&static_member.object, ctx, &mut Vec::new())
            || member_root_identifier(&static_member.object).is_some_and(|identifier| {
                identifier.name == "document" && is_unresolved_identifier(identifier, ctx)
            }))
    {
        return Some(format!(".{method_name}()"));
    }
    if NOTIFICATION_METHOD_NAMES.contains(&method_name)
        && is_notification_receiver(&static_member.object, ctx)
    {
        return Some(format!("{method_name}()"));
    }
    None
}

fn static_member_expression<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::StaticMemberExpression<'a>> {
    match expression.get_inner_expression().as_member_expression()? {
        MemberExpression::StaticMemberExpression(member) => Some(member),
        _ => None,
    }
}

fn is_storage_receiver(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        return STORAGE_RECEIVER_NAMES.contains(&identifier.name.as_str())
            && is_unresolved_identifier(identifier, ctx);
    }
    let Some(member) = static_member_expression(expression) else {
        return false;
    };
    STORAGE_RECEIVER_NAMES.contains(&member.property.name.as_str())
        && (is_unresolved_identifier_named(&member.object, "window", ctx)
            || is_unresolved_identifier_named(&member.object, "globalThis", ctx))
}

fn is_notification_receiver<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    if let Some(import_entry) = resolve_identifier_import(identifier, ctx) {
        let imported_name = match &import_entry.import_name {
            crate::module_record::ImportImportName::Default(_) => Some("default"),
            crate::module_record::ImportImportName::Name(name) => Some(name.name()),
            crate::module_record::ImportImportName::NamespaceObject => None,
        };
        return is_notification_module_source(import_entry.module_request.name())
            && imported_name.is_some_and(|name| {
                name == "default" || NOTIFICATION_RECEIVER_NAMES.contains(&name)
            });
    }
    let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
        return false;
    };
    let Expression::CallExpression(hook_call) = initializer.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(hook_identifier) = hook_call.callee.get_inner_expression() else {
        return false;
    };
    let Some(import_entry) = resolve_identifier_import(hook_identifier, ctx) else {
        return false;
    };
    let crate::module_record::ImportImportName::Name(imported_name) = &import_entry.import_name else {
        return false;
    };
    is_notification_module_source(import_entry.module_request.name())
        && matches!(imported_name.name(), "useMessage" | "useNotification" | "useToast")
}

fn is_notification_module_source(module_source: &str) -> bool {
    NOTIFICATION_MODULE_SOURCES.iter().any(|candidate| {
        module_source == *candidate
            || module_source
                .strip_prefix(candidate)
                .is_some_and(|suffix| suffix.starts_with('/'))
    }) || module_source
        .split(|character: char| matches!(character, '/' | '_' | '.' | '-'))
        .any(|segment| matches!(segment.to_ascii_lowercase().as_str(), "toast" | "toasts" | "notification" | "notifications"))
}

fn has_react_ref_current_origin(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if let Some(member) = static_member_expression(expression)
        && member.property.name == "current"
        && let Expression::Identifier(identifier) = member.object.get_inner_expression()
    {
        return identifier_is_react_ref(identifier, ctx);
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).is_some_and(|initializer| {
        has_react_ref_current_origin(initializer, ctx, visited_symbol_ids)
    })
}

fn identifier_is_react_ref(identifier: &IdentifierReference<'_>, ctx: &LintContext<'_>) -> bool {
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
    let Some(Expression::CallExpression(use_ref_call)) = &declarator.init else {
        return false;
    };
    is_react_hook_call(use_ref_call, &["useRef"], ctx)
}

fn external_assignment_description(
    root_identifier: &IdentifierReference<'_>,
    updater: UpdaterFunction,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id()
    else {
        return Some(format!("the external value \"{}\"", root_identifier.name));
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if updater.params_span.contains_inclusive(declaration.span()) {
        return Some(format!(
            "the updater argument \"{}\"",
            root_identifier.name
        ));
    }
    (!updater.span.contains_inclusive(declaration.span())).then(|| {
        format!("the captured value \"{}\"", root_identifier.name)
    })
}

fn assignment_target_root_identifier<'a>(
    target: &'a AssignmentTarget<'a>,
) -> Option<&'a IdentifierReference<'a>> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier),
        _ => member_root_identifier(target.as_member_expression()?.object()),
    }
}

fn simple_assignment_target_root_identifier<'a>(
    target: &'a SimpleAssignmentTarget<'a>,
) -> Option<&'a IdentifierReference<'a>> {
    match target {
        SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier),
        _ => member_root_identifier(target.as_member_expression()?.object()),
    }
}

fn member_root_identifier<'a>(expression: &'a Expression<'a>) -> Option<&'a IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => member_root_identifier(expression.as_member_expression()?.object()),
    }
}

fn is_unresolved_identifier(identifier: &IdentifierReference<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn is_unresolved_identifier_named(
    expression: &Expression<'_>,
    expected_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == expected_name && is_unresolved_identifier(identifier, ctx)
    )
}
