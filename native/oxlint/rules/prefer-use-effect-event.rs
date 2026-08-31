use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, FunctionType, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const TIMER_AND_SCHEDULER_NAMES: [&str; 5] = [
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "requestIdleCallback",
    "queueMicrotask",
];
const SUBSCRIPTION_METHOD_NAMES: [&str; 7] = [
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "watch",
    "listen",
    "sub",
];
const STABLE_REACT_HOOK_VALUE_NAMES: [&str; 6] = [
    "useActionState",
    "useEffectEvent",
    "useReducer",
    "useRef",
    "useState",
    "useTransition",
];

#[derive(Debug, Default, Clone)]
pub struct PreferUseEffectEvent;

declare_oxc_lint!(
    /// Warns when an effect re-subscribes because a changing callback is a dependency.
    PreferUseEffectEvent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Effect re-subscribes on a changing callback.",
);

#[derive(Clone, Copy)]
struct CallArgumentUse {
    call_id: NodeId,
    argument_index: usize,
}

#[derive(Default)]
struct CallableReadClassification {
    has_any_read: bool,
    all_reads_are_in_sub_handlers: bool,
    first_sub_handler_name: Option<String>,
}

impl Rule for PreferUseEffectEvent {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut changing_callbacks_by_component = FxHashMap::<NodeId, FxHashSet<String>>::default();

        for component in ctx.nodes().iter().filter(|node| {
            matches!(
                node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) && prefer_effect_event_is_component_function(node, ctx)
        }) {
            changing_callbacks_by_component.insert(
                component.id(),
                prefer_effect_event_changing_callback_names(component, ctx),
            );
        }

        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
                continue;
            }
            let Some(component_id) =
                prefer_effect_event_direct_component_statement(effect_node, ctx)
            else {
                continue;
            };
            let Some(Expression::ArrayExpression(dependencies)) = effect_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if dependencies.elements.len() < 2
                || !dependencies.elements.iter().all(|element| {
                    matches!(
                        element
                            .as_expression()
                            .map(Expression::get_inner_expression),
                        Some(Expression::Identifier(_))
                    )
                })
            {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = exact_local_function_id_including_generators(
                callback_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            for dependency in &dependencies.elements {
                let Some(Expression::Identifier(identifier)) = dependency
                    .as_expression()
                    .map(Expression::get_inner_expression)
                else {
                    continue;
                };
                let dependency_name = identifier.name.as_str();
                let is_callback_prop = dependency_name.starts_with("on")
                    && dependency_name
                        .as_bytes()
                        .get(2)
                        .is_some_and(u8::is_ascii_uppercase)
                    && prefer_effect_event_component_has_prop(component_id, dependency_name, ctx);
                if !is_callback_prop
                    && !changing_callbacks_by_component
                        .get(&component_id)
                        .is_some_and(|names| names.contains(dependency_name))
                {
                    continue;
                }
                let classification =
                    prefer_effect_event_classify_callable_reads(identifier, callback_id, ctx);
                if !classification.has_any_read || !classification.all_reads_are_in_sub_handlers {
                    continue;
                }
                let sub_handler_label = classification.first_sub_handler_name.map_or_else(
                    || "an async sub-handler".to_string(),
                    |name| format!("`{name}`"),
                );
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your effect re-subscribes whenever \"{dependency_name}\" changes, even though it's only used inside {sub_handler_label}."
                    ))
                    .with_label(identifier.span),
                );
            }
        }
    }
}

fn prefer_effect_event_direct_component_statement(
    effect_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let statement = ctx.nodes().parent_node(effect_node.id());
    let AstKind::ExpressionStatement(expression_statement) = statement.kind() else {
        return None;
    };
    if expression_statement.expression.span() != effect_node.span() {
        return None;
    }
    let body = ctx.nodes().parent_node(statement.id());
    if !matches!(body.kind(), AstKind::FunctionBody(_)) {
        return None;
    }
    let component = ctx.nodes().parent_node(body.id());
    prefer_effect_event_is_component_function(component, ctx).then_some(component.id())
}

fn prefer_effect_event_is_component_function<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function.id.as_ref().is_none_or(|identifier| {
            identifier.name == "default"
                || identifier
                    .name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
        }) || matches!(
            ctx.nodes().parent_node(function_node.id()).kind(),
            AstKind::ExportDefaultDeclaration(_)
        );
    }
    if !matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        return false;
    }
    let mut current = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if matches!(parent.kind(), AstKind::CallExpression(_)) {
            current = transparent_expression_root(parent, ctx);
            continue;
        }
        return match parent.kind() {
            AstKind::VariableDeclarator(declarator) => declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| {
                    identifier
                        .name
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase)
                }),
            AstKind::ExportDefaultDeclaration(_) => true,
            _ => false,
        };
    }
}

fn prefer_effect_event_component_has_prop(
    component_id: NodeId,
    prop_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(component_id).kind() {
        AstKind::Function(function) => {
            function.params.items.iter().any(|parameter| {
                prefer_effect_event_pattern_has_name(&parameter.pattern, prop_name)
            })
        }
        AstKind::ArrowFunctionExpression(function) => {
            function.params.items.iter().any(|parameter| {
                prefer_effect_event_pattern_has_name(&parameter.pattern, prop_name)
            })
        }
        _ => false,
    }
}

fn prefer_effect_event_pattern_has_name(pattern: &BindingPattern<'_>, name: &str) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.name == name,
        BindingPattern::AssignmentPattern(assignment) => {
            prefer_effect_event_pattern_has_name(&assignment.left, name)
        }
        BindingPattern::ObjectPattern(object) => {
            object
                .properties
                .iter()
                .any(|property| prefer_effect_event_pattern_has_name(&property.value, name))
                || object
                    .rest
                    .as_ref()
                    .is_some_and(|rest| prefer_effect_event_pattern_has_name(&rest.argument, name))
        }
        BindingPattern::ArrayPattern(array) => {
            array
                .elements
                .iter()
                .flatten()
                .any(|element| prefer_effect_event_pattern_has_name(element, name))
                || array
                    .rest
                    .as_ref()
                    .is_some_and(|rest| prefer_effect_event_pattern_has_name(&rest.argument, name))
        }
    }
}

fn prefer_effect_event_changing_callback_names<'a>(
    component: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> FxHashSet<String> {
    let statements = match component.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| &body.statements),
        AstKind::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .map(|body| &body.statements),
        _ => None,
    };
    let Some(statements) = statements else {
        return FxHashSet::default();
    };
    let mut names = FxHashSet::default();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(use_callback_call)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if prefer_effect_event_is_changing_use_callback(use_callback_call, ctx) {
                names.insert(identifier.name.to_string());
            }
        }
    }
    names
}

fn prefer_effect_event_is_changing_use_callback<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !is_react_api_call(call, "useCallback", ctx) {
        return false;
    }
    let Some(Expression::ArrayExpression(dependencies)) = call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return true;
    };
    dependencies.elements.iter().any(|element| {
        element.as_expression().is_none_or(|expression| {
            !prefer_effect_event_is_stable_hook_dependency(expression, ctx)
        })
    })
}

fn prefer_effect_event_is_stable_hook_dependency(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let mut symbol_id = match ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    {
        Some(symbol_id) => symbol_id,
        None => return false,
    };
    let mut visited = FxHashSet::default();
    loop {
        if !visited.insert(symbol_id) {
            return false;
        }
        if prefer_effect_event_symbol_has_stable_hook_origin(symbol_id, ctx) {
            let Some(initializer) = prefer_effect_event_symbol_declarator(symbol_id, ctx)
                .and_then(|declarator| declarator.init.as_ref())
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            let Expression::CallExpression(hook_call) = initializer else {
                return false;
            };
            return STABLE_REACT_HOOK_VALUE_NAMES
                .iter()
                .any(|hook_name| is_react_api_call(hook_call, hook_name, ctx));
        }
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
        {
            return false;
        }
        let Some(declarator) = prefer_effect_event_symbol_declarator(symbol_id, ctx) else {
            return false;
        };
        let declaration_node = ctx.symbol_declaration(symbol_id);
        let variable_declaration = ctx.nodes().parent_node(declaration_node.id());
        if !matches!(
            variable_declaration.kind(),
            AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
        ) || !matches!(
            &declarator.id,
            BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id
        ) {
            return false;
        }
        let Some(Expression::Identifier(alias)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        let Some(next_symbol_id) = ctx
            .scoping()
            .get_reference(alias.reference_id())
            .symbol_id()
        else {
            return false;
        };
        symbol_id = next_symbol_id;
    }
}

fn prefer_effect_event_symbol_has_stable_hook_origin(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| !reference.is_read() || reference.is_write())
    {
        return false;
    }
    let Some(declarator) = prefer_effect_event_symbol_declarator(symbol_id, ctx) else {
        return false;
    };
    let Some(Expression::CallExpression(hook_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if ["useRef", "useEffectEvent"]
        .iter()
        .any(|hook_name| is_react_hook_call(hook_call, &[*hook_name], ctx))
    {
        return matches!(
            &declarator.id,
            BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id
        );
    }
    if !["useState", "useReducer", "useActionState", "useTransition"]
        .iter()
        .any(|hook_name| is_react_hook_call(hook_call, &[*hook_name], ctx))
    {
        return false;
    }
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.elements.get(1).and_then(Option::as_ref).is_some_and(|element| {
        let inner = match element {
            BindingPattern::AssignmentPattern(assignment) => &assignment.left,
            pattern => pattern,
        };
        matches!(inner, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
    })
}

fn prefer_effect_event_symbol_declarator<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::VariableDeclarator<'a>> {
    let mut node = ctx.symbol_declaration(symbol_id);
    loop {
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => return Some(declarator),
            AstKind::Program(_) | AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                return None;
            }
            _ => node = ctx.nodes().parent_node(node.id()),
        }
    }
}

fn prefer_effect_event_classify_callable_reads(
    dependency: &oxc_ast::ast::IdentifierReference<'_>,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> CallableReadClassification {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(dependency.reference_id())
        .symbol_id()
    else {
        return CallableReadClassification::default();
    };
    let mut classification = CallableReadClassification {
        all_reads_are_in_sub_handlers: true,
        ..CallableReadClassification::default()
    };
    let mut sub_handler_by_function = FxHashMap::<NodeId, Option<NodeId>>::default();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if !prefer_effect_event_is_descendant(reference_node.id(), callback_id, ctx)
            || prefer_effect_event_is_ignored_identifier_read(reference_node, ctx)
        {
            continue;
        }
        classification.has_any_read = true;
        let Some(enclosing_function_id) =
            prefer_effect_event_enclosing_function_inside(reference_node.id(), callback_id, ctx)
        else {
            classification.all_reads_are_in_sub_handlers = false;
            continue;
        };
        let Some(sub_handler_call_id) = *sub_handler_by_function
            .entry(enclosing_function_id)
            .or_insert_with(|| {
                prefer_effect_event_exclusive_sub_handler_call(enclosing_function_id, ctx)
            })
        else {
            classification.all_reads_are_in_sub_handlers = false;
            continue;
        };
        if classification.first_sub_handler_name.is_none() {
            classification.first_sub_handler_name =
                prefer_effect_event_callee_name(sub_handler_call_id, ctx);
        }
    }
    classification
}

fn prefer_effect_event_is_ignored_identifier_read(
    identifier: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(identifier.id());
    match parent.kind() {
        AstKind::ArrayExpression(_) => true,
        AstKind::ObjectProperty(property) => {
            !property.computed && !property.shorthand && property.key.span() == identifier.span()
        }
        _ => false,
    }
}

fn prefer_effect_event_enclosing_function_inside(
    node_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == callback_id {
            return None;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return Some(ancestor.id());
        }
    }
    None
}

fn prefer_effect_event_exclusive_sub_handler_call(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let function_node = ctx.nodes().get_node(function_id);
    let direct_parent = ctx.nodes().parent_node(function_node.id());
    if let AstKind::CallExpression(call) = direct_parent.kind()
        && call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_node.span())
        })
        && prefer_effect_event_is_sub_handler_call(call)
    {
        return Some(direct_parent.id());
    }

    let symbol_id = prefer_effect_event_function_binding_symbol(function_node, ctx)?;
    let mut registrations = Vec::new();
    let mut releases = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if prefer_effect_event_is_descendant(reference_node.id(), function_id, ctx) {
            continue;
        }
        if prefer_effect_event_is_function_binding_reference(reference_node, function_node, ctx) {
            continue;
        }
        if !reference.is_read() || reference.is_write() {
            return None;
        }
        let receiving_use = prefer_effect_event_call_argument_use(reference_node, ctx)?;
        let AstKind::CallExpression(receiving_call) =
            ctx.nodes().get_node(receiving_use.call_id).kind()
        else {
            return None;
        };
        if prefer_effect_event_is_sub_handler_call(receiving_call) {
            registrations.push(receiving_use);
            continue;
        }
        let method_name = prefer_effect_event_static_member_method_name(receiving_call)?;
        if prefer_effect_event_registration_method(method_name).is_none() {
            return None;
        }
        releases.push(receiving_use);
    }
    if registrations.is_empty()
        || releases.iter().any(|release| {
            !registrations.iter().any(|registration| {
                prefer_effect_event_registration_matches_release(*registration, *release, ctx)
            })
        })
    {
        return None;
    }
    Some(registrations[0].call_id)
}

fn prefer_effect_event_is_function_binding_reference<'a>(
    reference_node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    matches!(
        parent.kind(),
        AstKind::AssignmentExpression(assignment)
            if assignment.left.span() == reference_root.span()
                && assignment.right.span().contains_inclusive(function_node.span())
    )
}

fn prefer_effect_event_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id()),
        AstKind::AssignmentExpression(assignment) => {
            let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                &assignment.left
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        AstKind::CallExpression(_) => {
            let call_root = transparent_expression_root(parent, ctx);
            let call_parent = ctx.nodes().parent_node(call_root.id());
            match call_parent.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn prefer_effect_event_call_argument_use<'a>(
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<CallArgumentUse> {
    let argument_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(argument_root.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return None;
    };
    let argument_index = call.arguments.iter().position(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == argument_root.span())
    })?;
    Some(CallArgumentUse {
        call_id: parent.id(),
        argument_index,
    })
}

fn prefer_effect_event_is_sub_handler_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            TIMER_AND_SCHEDULER_NAMES.contains(&identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member) => {
            SUBSCRIPTION_METHOD_NAMES.contains(&member.property.name.as_str())
        }
        _ => false,
    }
}

fn prefer_effect_event_static_member_method_name<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a str> {
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return None;
    };
    Some(member.property.name.as_str())
}

fn prefer_effect_event_registration_method(release_method: &str) -> Option<&'static str> {
    match release_method {
        "off" => Some("on"),
        "removeEventListener" => Some("addEventListener"),
        "removeListener" => Some("addListener"),
        "unlisten" => Some("listen"),
        "unsub" => Some("sub"),
        "unsubscribe" => Some("subscribe"),
        "unwatch" => Some("watch"),
        _ => None,
    }
}

fn prefer_effect_event_registration_matches_release(
    registration: CallArgumentUse,
    release: CallArgumentUse,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::CallExpression(registration_call) =
        ctx.nodes().get_node(registration.call_id).kind()
    else {
        return false;
    };
    let AstKind::CallExpression(release_call) = ctx.nodes().get_node(release.call_id).kind() else {
        return false;
    };
    let Some(release_method) = prefer_effect_event_static_member_method_name(release_call) else {
        return false;
    };
    let Some(expected_registration_method) =
        prefer_effect_event_registration_method(release_method)
    else {
        return false;
    };
    if prefer_effect_event_static_member_method_name(registration_call)
        != Some(expected_registration_method)
        || registration.argument_index != release.argument_index
        || registration_call.arguments.len() != release_call.arguments.len()
    {
        return false;
    }
    let Some(registration_member) = registration_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(release_member) = release_call
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let registration_receiver_key =
        resolve_expression_key(registration_member.object(), ctx, &mut Vec::new());
    if registration_receiver_key.is_none()
        || registration_receiver_key
            != resolve_expression_key(release_member.object(), ctx, &mut Vec::new())
    {
        return false;
    }
    registration_call
        .arguments
        .iter()
        .zip(&release_call.arguments)
        .enumerate()
        .all(
            |(argument_index, (registration_argument, release_argument))| {
                argument_index == registration.argument_index
                    || prefer_effect_event_argument_key(registration_argument, ctx).is_some_and(
                        |key| Some(key) == prefer_effect_event_argument_key(release_argument, ctx),
                    )
            },
        )
}

fn prefer_effect_event_argument_key(
    argument: &Argument<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let expression = argument.as_expression()?.get_inner_expression();
    resolve_expression_key(expression, ctx, &mut Vec::new()).or_else(|| match expression {
        Expression::BooleanLiteral(literal) => Some(format!("boolean:{}", literal.value)),
        _ => None,
    })
}

fn prefer_effect_event_callee_name(call_id: NodeId, ctx: &LintContext<'_>) -> Option<String> {
    let AstKind::CallExpression(call) = ctx.nodes().get_node(call_id).kind() else {
        return None;
    };
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        Expression::ComputedMemberExpression(member) => {
            match member.expression.get_inner_expression() {
                Expression::Identifier(identifier) => Some(identifier.name.to_string()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn prefer_effect_event_is_descendant(
    node_id: NodeId,
    ancestor_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .any(|ancestor| ancestor.id() == ancestor_id)
}
