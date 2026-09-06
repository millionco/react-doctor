use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrowFunctionExpression, CallExpression, Class, Expression, Function,
        JSXAttributeName, JSXElementName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::{is_es6_component, is_react_component_name},
};

fn no_unstable_nested_components_diagnostic(
    span: Span,
    parent_name: Option<&str>,
) -> OxcDiagnostic {
    let mut message = "Your users lose this component's state on every render because it's defined inside another component".to_string();
    if let Some(parent_name) = parent_name {
        message.push_str(&format!(" (`{parent_name}`)"));
    }
    message.push('.');
    OxcDiagnostic::warn(message).with_label(span)
}

struct NoUnstableNestedComponentsSettings {
    allow_as_props: bool,
    prop_name_pattern: String,
}

#[derive(Debug, Clone, Default)]
pub struct NoUnstableNestedComponents;

declare_oxc_lint!(
    /// Disallows components defined inside another component.
    NoUnstableNestedComponents,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallows defining React components inside other components.",
);

impl Rule for NoUnstableNestedComponents {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let settings = no_unstable_nested_components_settings(ctx);
        let mut component_output_cache = FxHashMap::default();
        let mut class_component_cache = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let candidate = match node.kind() {
                AstKind::Function(function) => {
                    function_candidate(function, node, ctx, &mut component_output_cache)
                }
                AstKind::ArrowFunctionExpression(arrow) => {
                    arrow_candidate(arrow, node, ctx, &mut component_output_cache)
                }
                AstKind::Class(class) => {
                    class_candidate(class, node, ctx, &mut class_component_cache)
                }
                AstKind::CallExpression(call) => hoc_call_candidate(call, node, ctx),
                _ => None,
            };
            let Some(candidate) = candidate else {
                continue;
            };
            report_candidate(
                node,
                candidate,
                &settings,
                ctx,
                &mut component_output_cache,
                &mut class_component_cache,
            );
        }
    }
}

#[derive(Debug, Clone)]
struct ComponentCandidate {
    span: Span,
    prop_name: Option<String>,
    required_instantiation_name: Option<String>,
    required_instantiation_symbol: Option<SymbolId>,
}

fn no_unstable_nested_components_settings(
    ctx: &LintContext<'_>,
) -> NoUnstableNestedComponentsSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noUnstableNestedComponents"));
    NoUnstableNestedComponentsSettings {
        allow_as_props: rule_settings
            .and_then(|settings| settings.get("allowAsProps"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or_else(|| should_use_curated_port_behavior(ctx)),
        prop_name_pattern: rule_settings
            .and_then(|settings| settings.get("propNamePattern"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("render*")
            .to_string(),
    }
}

fn report_candidate<'a>(
    node: &AstNode<'a>,
    candidate: ComponentCandidate,
    settings: &NoUnstableNestedComponentsSettings,
    ctx: &LintContext<'a>,
    component_output_cache: &mut FxHashMap<NodeId, bool>,
    class_component_cache: &mut FxHashMap<NodeId, bool>,
) {
    if is_return_of_map_callback(node, ctx) {
        return;
    }
    if let Some(prop_name) = candidate.prop_name.as_deref() {
        if prop_name == "children"
            || simple_glob_matches(&settings.prop_name_pattern, prop_name)
            || settings.allow_as_props
        {
            return;
        }
    }
    let Some(parent_name) =
        find_parent_component_name(node, ctx, component_output_cache, class_component_cache)
    else {
        return;
    };
    if let Some(symbol_id) = candidate.required_instantiation_symbol {
        if symbol_has_write_reference(symbol_id, ctx)
            || !symbol_flows_to_component_instantiation(symbol_id, ctx, &mut FxHashSet::default())
        {
            return;
        }
    } else if let Some(name) = candidate.required_instantiation_name.as_deref()
        && !unbound_component_name_is_instantiated(name, ctx)
    {
        return;
    }
    ctx.diagnostic(no_unstable_nested_components_diagnostic(
        candidate.span,
        parent_name.as_deref(),
    ));
}

fn function_candidate<'a>(
    function: &Function<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_output_cache: &mut FxHashMap<NodeId, bool>,
) -> Option<ComponentCandidate> {
    if is_first_argument_of_hoc_call(node, ctx)
        || !function_has_component_output(node, ctx, component_output_cache)
    {
        return None;
    }
    function_like_candidate(function.span, function_name(function, node, ctx), node, ctx)
}

fn arrow_candidate<'a>(
    arrow: &ArrowFunctionExpression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_output_cache: &mut FxHashMap<NodeId, bool>,
) -> Option<ComponentCandidate> {
    if is_first_argument_of_hoc_call(node, ctx)
        || !function_has_component_output(node, ctx, component_output_cache)
    {
        return None;
    }
    function_like_candidate(arrow.span, function_like_name(node, ctx), node, ctx)
}

fn function_like_candidate<'a>(
    span: Span,
    inferred_name: Option<String>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<ComponentCandidate> {
    let prop_name = component_declared_prop_name(node, ctx);
    let is_object_callback = is_object_callback_candidate(node, ctx);
    let is_name_candidate = inferred_name
        .as_deref()
        .is_some_and(is_react_component_name);
    if !is_name_candidate && prop_name.is_none() && !is_object_callback {
        return None;
    }
    let requires_instantiation = is_name_candidate && prop_name.is_none() && !is_object_callback;
    let required_instantiation_symbol = requires_instantiation
        .then(|| candidate_binding_symbol(node, ctx))
        .flatten();
    let required_instantiation_name =
        if requires_instantiation && required_instantiation_symbol.is_none() {
            inferred_name
        } else {
            None
        };
    Some(ComponentCandidate {
        span,
        prop_name,
        required_instantiation_name,
        required_instantiation_symbol,
    })
}

fn class_candidate<'a>(
    class: &Class<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    class_component_cache: &mut FxHashMap<NodeId, bool>,
) -> Option<ComponentCandidate> {
    if !class_is_react_component(node, ctx, class_component_cache) {
        return None;
    }
    let name = class_name(class, node, ctx)?;
    if !is_react_component_name(&name) {
        return None;
    }
    Some(ComponentCandidate {
        span: class.span,
        prop_name: component_declared_prop_name(node, ctx),
        required_instantiation_name: None,
        required_instantiation_symbol: None,
    })
}

fn hoc_call_candidate<'a>(
    call: &CallExpression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<ComponentCandidate> {
    if is_first_argument_of_hoc_call(node, ctx) || !is_hoc_component_call(call, ctx) {
        return None;
    }
    let prop_name = component_declared_prop_name(node, ctx);
    let inferred_name = function_like_name(node, ctx);
    if prop_name.is_none()
        && !inferred_name
            .as_deref()
            .is_some_and(is_react_component_name)
    {
        return None;
    }
    Some(ComponentCandidate {
        span: call.span,
        required_instantiation_name: if prop_name.is_none() {
            inferred_name
        } else {
            None
        },
        prop_name,
        required_instantiation_symbol: None,
    })
}

enum ParentComponentName {
    Named(String),
    Anonymous,
}

impl ParentComponentName {
    fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Named(name) => Some(name),
            Self::Anonymous => None,
        }
    }
}

fn find_parent_component_name<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_output_cache: &mut FxHashMap<NodeId, bool>,
    class_component_cache: &mut FxHashMap<NodeId, bool>,
) -> Option<ParentComponentName> {
    for ancestor_id in ctx
        .nodes()
        .ancestor_ids(node.id())
        .filter(|&id| id != node.id())
    {
        let ancestor = ctx.nodes().get_node(ancestor_id);
        match ancestor.kind() {
            AstKind::Function(function) => {
                if !function_has_component_output(ancestor, ctx, component_output_cache) {
                    continue;
                }
                if let Some(name) = function_name(function, ancestor, ctx) {
                    if is_react_component_name(&name) {
                        return Some(ParentComponentName::Named(name));
                    }
                    continue;
                }

                if is_anonymous_default_export(ancestor, ctx) {
                    return Some(ParentComponentName::Anonymous);
                }
            }
            AstKind::ArrowFunctionExpression(_) => {
                if !function_has_component_output(ancestor, ctx, component_output_cache) {
                    continue;
                }
                if let Some(name) = function_like_name(ancestor, ctx) {
                    if is_react_component_name(&name) {
                        return Some(ParentComponentName::Named(name));
                    }
                    continue;
                }

                if is_anonymous_default_export(ancestor, ctx) {
                    return Some(ParentComponentName::Anonymous);
                }
            }
            AstKind::Class(class) => {
                if class_is_react_component(ancestor, ctx, class_component_cache)
                    && let Some(name) = class_name(class, ancestor, ctx)
                    && is_react_component_name(&name)
                {
                    return Some(ParentComponentName::Named(name));
                }
            }
            _ => {}
        }
    }
    None
}

fn function_name(func: &Function<'_>, node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    func.name()
        .map(|name| name.to_string())
        .or_else(|| function_like_name(node, ctx))
}

fn function_like_name(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::VariableDeclarator(decl) => {
            decl.id.get_identifier_name().map(|name| name.to_string())
        }
        AstKind::ObjectProperty(prop) => prop.key.static_name().map(std::borrow::Cow::into_owned),
        AstKind::AssignmentExpression(assign) => {
            assign.left.get_identifier_name().map(ToString::to_string)
        }
        _ => None,
    }
}

fn class_name(class: &Class<'_>, node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    class
        .name()
        .map(|name| name.to_string())
        .or_else(|| function_like_name(node, ctx))
}

fn is_anonymous_default_export(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(
        ctx.nodes().parent_node(node.id()).kind(),
        AstKind::ExportDefaultDeclaration(_)
    )
}

fn component_declared_prop_name(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    for ancestor in ctx
        .nodes()
        .ancestors(node.id())
        .filter(|ancestor| ancestor.id() != node.id())
    {
        match ancestor.kind() {
            AstKind::ObjectProperty(property) => {
                let prop_name = property.key.static_name().map(std::borrow::Cow::into_owned);
                for property_ancestor in ctx
                    .nodes()
                    .ancestors(ancestor.id())
                    .filter(|candidate| candidate.id() != ancestor.id())
                {
                    match property_ancestor.kind() {
                        AstKind::JSXExpressionContainer(_) => {
                            let parent = ctx.nodes().parent_node(property_ancestor.id());
                            return match parent.kind() {
                                AstKind::JSXAttribute(attribute) => jsx_attribute_name(attribute),
                                _ => prop_name,
                            };
                        }
                        AstKind::CallExpression(_) => return prop_name,
                        _ => {}
                    }
                }
                return prop_name;
            }
            AstKind::JSXExpressionContainer(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                return match parent.kind() {
                    AstKind::JSXAttribute(attribute) => jsx_attribute_name(attribute),
                    _ => None,
                };
            }
            AstKind::CallExpression(_) => return None,
            _ => {}
        }
    }
    None
}

fn jsx_attribute_name(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> Option<String> {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

fn is_object_callback_candidate(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::ObjectProperty(property) = parent.kind() else {
        return false;
    };
    if property
        .key
        .static_name()
        .is_some_and(|name| name.starts_with("render"))
    {
        return false;
    }
    ctx.nodes()
        .ancestors(parent.id())
        .filter(|ancestor| ancestor.id() != parent.id())
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::JSXExpressionContainer(_) => Some(false),
            AstKind::CallExpression(_) | AstKind::ArrayExpression(_) => Some(true),
            _ => None,
        })
        .unwrap_or(false)
}

fn is_return_of_map_callback(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    if let AstKind::CallExpression(call) = parent.kind()
        && is_map_like_call(call)
    {
        return true;
    }
    if matches!(
        parent.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    ) {
        let callback_parent = ctx.nodes().parent_node(parent.id());
        return matches!(callback_parent.kind(), AstKind::CallExpression(call) if is_map_like_call(call));
    }
    false
}

fn is_map_like_call(call: &CallExpression<'_>) -> bool {
    call.callee
        .as_member_expression()
        .and_then(oxc_ast::ast::MemberExpression::static_property_name)
        .is_some_and(|name| {
            matches!(
                name,
                "map" | "forEach" | "filter" | "flatMap" | "reduce" | "reduceRight"
            )
        })
}

fn is_first_argument_of_hoc_call(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    is_hoc_callee(call)
        && call
            .arguments
            .first()
            .is_some_and(|argument| argument.span() == node.span())
}

fn is_hoc_component_call<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    if is_react_api_call(call, "lazy", ctx) {
        return true;
    }
    is_hoc_callee(call) && hoc_call_contains_component(call, ctx)
}

fn is_hoc_callee(call: &CallExpression<'_>) -> bool {
    call.callee_name().is_some_and(|name| {
        matches!(
            name,
            "memo"
                | "forwardRef"
                | "createReactClass"
                | "createClass"
                | "lazy"
                | "observer"
                | "Observer"
                | "compose"
        )
    })
}

fn hoc_call_contains_component(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(first_argument) = call.arguments.first() else {
        return false;
    };
    match first_argument {
        Argument::CallExpression(inner_call) if is_hoc_callee(inner_call) => {
            hoc_call_contains_component(inner_call, ctx)
        }
        _ => expression_span_contains_component_output(first_argument.span(), ctx),
    }
}

fn expression_span_contains_component_output(span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && match candidate.kind() {
                AstKind::JSXElement(_) | AstKind::JSXFragment(_) => true,
                AstKind::CallExpression(call) => is_react_api_call(call, "createElement", ctx),
                _ => false,
            }
            && !ctx
                .nodes()
                .ancestors(candidate.id())
                .filter(|ancestor| ancestor.id() != candidate.id())
                .take_while(|ancestor| span.contains_inclusive(ancestor.span()))
                .any(|ancestor| {
                    ancestor.span() != span
                        && matches!(
                            ancestor.kind(),
                            AstKind::Function(_)
                                | AstKind::ArrowFunctionExpression(_)
                                | AstKind::Class(_)
                        )
                })
    })
}

fn function_has_component_output<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    cache: &mut FxHashMap<NodeId, bool>,
) -> bool {
    if let Some(result) = cache.get(&node.id()) {
        return *result;
    }
    let result = expression_span_contains_component_output(node.span(), ctx)
        || function_returns_component_output(
            node,
            ctx,
            &mut FxHashSet::default(),
            &mut FxHashSet::default(),
        );
    cache.insert(node.id(), result);
    result
}

fn function_returns_component_output<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
    visited_expressions: &mut FxHashSet<Span>,
) -> bool {
    function_returns_component_output_with_cache(
        function_node,
        ctx,
        &mut PossibleAssignedExpressionCache::default(),
        visited_functions,
        visited_expressions,
    )
}

fn function_returns_component_output_with_cache<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
    visited_expressions: &mut FxHashSet<Span>,
) -> bool {
    if !visited_functions.insert(function_node.id()) {
        return false;
    }
    let result = match function_node.kind() {
        AstKind::ArrowFunctionExpression(arrow) => {
            arrow.get_expression().is_some_and(|expression| {
                returned_expression_matches_component_output(
                    expression,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                )
            }) || direct_function_return_expressions(function_node, ctx).any(|expression| {
                returned_expression_matches_component_output(
                    expression,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                )
            })
        }
        AstKind::Function(_) => {
            direct_function_return_expressions(function_node, ctx).any(|expression| {
                returned_expression_matches_component_output(
                    expression,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                )
            })
        }
        _ => false,
    };
    visited_functions.remove(&function_node.id());
    result
}

fn direct_function_return_expressions<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> impl Iterator<Item = &'a Expression<'a>> {
    ctx.nodes().iter().filter_map(move |candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return None;
        };
        if nearest_function_id(candidate.id(), ctx) != Some(function_node.id()) {
            return None;
        }
        return_statement.argument.as_ref()
    })
}

fn nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestor_ids(node_id)
        .filter(|ancestor_id| *ancestor_id != node_id)
        .find(|ancestor_id| {
            matches!(
                ctx.nodes().kind(*ancestor_id),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
}

fn returned_expression_matches_component_output<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
    visited_expressions: &mut FxHashSet<Span>,
) -> bool {
    let expression = expression.get_inner_expression();
    if !visited_expressions.insert(expression.span()) {
        return false;
    }
    let result = if expression_span_contains_component_output(expression.span(), ctx) {
        true
    } else {
        match expression {
            Expression::Identifier(identifier) => ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    resolve_cfg_assigned_expressions_for_reference(
                        identifier,
                        symbol_id,
                        ctx,
                        assigned_expression_cache,
                    )
                    .into_iter()
                    .any(|initializer| {
                        !matches!(
                            initializer.get_inner_expression(),
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        ) && returned_expression_matches_component_output(
                            initializer,
                            ctx,
                            assigned_expression_cache,
                            visited_functions,
                            visited_expressions,
                        )
                    })
                }),
            Expression::CallExpression(call) if call.arguments.is_empty() => {
                let Expression::Identifier(callee) = &call.callee else {
                    visited_expressions.remove(&expression.span());
                    return false;
                };
                local_zero_argument_function_id(callee, ctx).is_some_and(|function_id| {
                    function_returns_component_output_with_cache(
                        ctx.nodes().get_node(function_id),
                        ctx,
                        assigned_expression_cache,
                        visited_functions,
                        visited_expressions,
                    )
                })
            }
            Expression::ConditionalExpression(conditional) => {
                returned_expression_matches_component_output(
                    &conditional.consequent,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                ) || returned_expression_matches_component_output(
                    &conditional.alternate,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                )
            }
            Expression::LogicalExpression(logical) => {
                returned_expression_matches_component_output(
                    &logical.left,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                ) || returned_expression_matches_component_output(
                    &logical.right,
                    ctx,
                    assigned_expression_cache,
                    visited_functions,
                    visited_expressions,
                )
            }
            _ => false,
        }
    };
    visited_expressions.remove(&expression.span());
    result
}

fn local_zero_argument_function_id<'a>(
    callee: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if function.is_function_declaration()
                && !function.r#async
                && !function.generator
                && function.params.items.is_empty() =>
        {
            Some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) =>
        {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            let function_id = match initializer {
                Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    function.node_id.get()
                }
                Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    function.node_id.get()
                }
                _ => return None,
            };
            Some(function_id)
        }
        _ => None,
    }
}

fn class_is_react_component<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    cache: &mut FxHashMap<NodeId, bool>,
) -> bool {
    if let Some(result) = cache.get(&node.id()) {
        return *result;
    }
    let result =
        is_es6_component(node) || expression_span_contains_component_output(node.span(), ctx);
    cache.insert(node.id(), result);
    result
}

fn candidate_binding_symbol(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(node.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == node.span())
    {
        return declarator
            .id
            .get_binding_identifier()
            .map(oxc_ast::ast::BindingIdentifier::symbol_id);
    }
    match node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(oxc_ast::ast::BindingIdentifier::symbol_id),
        _ => None,
    }
}

fn symbol_has_write_reference(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
}

fn symbol_flows_to_component_instantiation<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .any(|reference| {
            reference_flows_to_component_instantiation(reference.node_id(), ctx, visited_symbols)
        })
}

fn reference_flows_to_component_instantiation<'a>(
    reference_node_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let mut value_node = ctx.nodes().get_node(reference_node_id);
    loop {
        let parent = ctx.nodes().parent_node(value_node.id());
        match parent.kind() {
            AstKind::JSXOpeningElement(opening) => {
                return opening.name.span().contains_inclusive(value_node.span());
            }
            AstKind::JSXExpressionContainer(_) => {
                let attribute_parent = ctx.nodes().parent_node(parent.id());
                return matches!(
                    attribute_parent.kind(),
                    AstKind::JSXAttribute(attribute) if is_element_type_jsx_attribute(attribute)
                );
            }
            AstKind::ReturnStatement(_) | AstKind::ArrowFunctionExpression(_) => return false,
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_) => {
                value_node = parent;
            }
            AstKind::CallExpression(call) => {
                if call.callee.span().contains_inclusive(value_node.span()) {
                    return false;
                }
                if call
                    .arguments
                    .first()
                    .is_some_and(|argument| argument.span().contains_inclusive(value_node.span()))
                    && is_react_api_call(call, "useMemo", ctx)
                {
                    return false;
                }
                if call
                    .arguments
                    .first()
                    .is_some_and(|argument| argument.span().contains_inclusive(value_node.span()))
                    && is_react_api_call(call, "createElement", ctx)
                {
                    return true;
                }
                value_node = parent;
            }
            AstKind::VariableDeclarator(declarator) => {
                if !declarator.init.as_ref().is_some_and(|initializer| {
                    initializer.span().contains_inclusive(value_node.span())
                }) {
                    return false;
                }
                let Some(alias) = declarator.id.get_binding_identifier() else {
                    return false;
                };
                let alias_symbol = alias.symbol_id();
                if !ctx.scoping().symbol_flags(alias_symbol).is_const_variable() {
                    return false;
                }
                return symbol_flows_to_component_instantiation(alias_symbol, ctx, visited_symbols);
            }
            AstKind::AssignmentExpression(_) => return false,
            AstKind::ObjectProperty(property) => {
                if !property.value.span().contains_inclusive(value_node.span()) {
                    return false;
                }
                value_node = parent;
            }
            AstKind::ObjectExpression(_)
            | AstKind::ArrayExpression(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_) => {
                value_node = parent;
            }
            _ => return false,
        }
    }
}

fn is_element_type_jsx_attribute(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    let Some(name) = jsx_attribute_name(attribute) else {
        return false;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "as" | "body" | "calendarcontainer" | "component" | "fallback" | "tooltip"
    ) || name.ends_with("Component")
}

fn unbound_component_name_is_instantiated(name: &str, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| match node.kind() {
        AstKind::JSXOpeningElement(opening) => {
            jsx_element_name_matches_unbound_name(&opening.name, name)
        }
        AstKind::CallExpression(call) if is_react_api_call(call, "createElement", ctx) => call
            .arguments
            .first()
            .is_some_and(|argument| expression_name_matches_unbound_name(argument, name)),
        _ => false,
    })
}

fn jsx_element_name_matches_unbound_name(name: &JSXElementName<'_>, expected: &str) -> bool {
    match name {
        JSXElementName::Identifier(identifier) => identifier.name == expected,
        JSXElementName::IdentifierReference(identifier) => identifier.name == expected,
        JSXElementName::MemberExpression(member) => {
            jsx_member_last_property_name(member) == Some(expected)
                || jsx_member_full_name(member).as_deref() == Some(expected)
        }
        JSXElementName::NamespacedName(_) | JSXElementName::ThisExpression(_) => false,
    }
}

fn jsx_member_last_property_name<'a>(
    member: &'a oxc_ast::ast::JSXMemberExpression<'a>,
) -> Option<&'a str> {
    Some(member.property.name.as_str())
}

fn jsx_member_full_name(member: &oxc_ast::ast::JSXMemberExpression<'_>) -> Option<String> {
    fn collect_object(
        object: &oxc_ast::ast::JSXMemberExpressionObject<'_>,
        segments: &mut Vec<String>,
    ) -> bool {
        match object {
            oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => {
                segments.push(identifier.name.to_string());
                true
            }
            oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(member) => {
                if !collect_object(&member.object, segments) {
                    return false;
                }
                segments.push(member.property.name.to_string());
                true
            }
            oxc_ast::ast::JSXMemberExpressionObject::ThisExpression(_) => false,
        }
    }
    let mut segments = Vec::new();
    if !collect_object(&member.object, &mut segments) {
        return None;
    }
    segments.push(member.property.name.to_string());
    Some(segments.join("."))
}

fn expression_name_matches_unbound_name(argument: &Argument<'_>, expected: &str) -> bool {
    let Some(expression) = argument.as_expression() else {
        return false;
    };
    match expression {
        Expression::Identifier(identifier) => identifier.name == expected,
        _ => {
            expression
                .as_member_expression()
                .and_then(oxc_ast::ast::MemberExpression::static_property_name)
                == Some(expected)
        }
    }
}

fn simple_glob_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let mut pattern_index = 0;
    let mut value_index = 0;
    let mut wildcard_index = None;
    let mut wildcard_value_index = 0;
    while value_index < value.len() {
        if pattern.get(pattern_index) == value.get(value_index) {
            pattern_index += 1;
            value_index += 1;
        } else if pattern.get(pattern_index) == Some(&b'*') {
            wildcard_index = Some(pattern_index);
            pattern_index += 1;
            wildcard_value_index = value_index;
        } else if let Some(last_wildcard_index) = wildcard_index {
            pattern_index = last_wildcard_index + 1;
            wildcard_value_index += 1;
            value_index = wildcard_value_index;
        } else {
            return false;
        }
    }
    while pattern.get(pattern_index) == Some(&b'*') {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}
