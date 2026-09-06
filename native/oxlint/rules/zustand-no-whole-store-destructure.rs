use oxc_ast::{
    AstKind as ZustandWholeStoreAstKind,
    ast::{BindingPattern, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use rustc_hash::FxHashMap;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "This hook subscribes to the whole Zustand store, so every store update rerenders this component. Pass a selector for the state it reads.";
const REACT_HOOK_NAMES: [&str; 16] = [
    "use",
    "useState",
    "useRef",
    "useMemo",
    "useCallback",
    "useReducer",
    "useContext",
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useImperativeHandle",
    "useSyncExternalStore",
    "useDeferredValue",
    "useTransition",
    "useId",
    "useDebugValue",
];

#[derive(Debug, Default, Clone)]
pub struct ZustandNoWholeStoreDestructure;

declare_oxc_lint!(
    /// Warn when a render subscribes to an entire Zustand store.
    ZustandNoWholeStoreDestructure,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Whole Zustand store subscribed during render.",
);

impl Rule for ZustandNoWholeStoreDestructure {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut component_evidence = FxHashMap::default();
        let mut property_write_analysis = None;
        let mut assigned_expression_cache = PossibleAssignedExpressionCache::default();
        for node in ctx.nodes().iter() {
            let ZustandWholeStoreAstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !zustand_whole_store_is_direct_render_call(
                node,
                ctx,
                &node_index,
                &mut component_evidence,
                &mut property_write_analysis,
                &mut assigned_expression_cache,
            ) {
                continue;
            }
            let is_bound_store_call = call.arguments.is_empty()
                && matches!(
                    call.callee.get_inner_expression(),
                    Expression::Identifier(_)
                )
                && zustand_whole_store_is_store_value(
                    &call.callee,
                    &[
                        ZustandStoreFactoryApi::Create,
                        ZustandStoreFactoryApi::CreateWithEqualityFn,
                    ],
                    ctx,
                    &mut Vec::new(),
                );
            if !is_bound_store_call && !zustand_whole_store_is_vanilla_hook_call(call, ctx) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

fn zustand_whole_store_is_vanilla_hook_call<'node, 'ast>(
    call: &'node oxc_ast::ast::CallExpression<'ast>,
    ctx: &LintContext<'ast>,
) -> bool {
    if call.arguments.len() != 1
        || !resolve_zustand_api_binding(&call.callee, ctx).is_some_and(|binding| {
            matches!(
                binding.api_name,
                ZustandApiName::UseStore | ZustandApiName::UseStoreWithEqualityFn
            )
        })
    {
        return false;
    }
    call.arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|store| {
            zustand_whole_store_is_store_value(
                store,
                &[ZustandStoreFactoryApi::CreateStore],
                ctx,
                &mut Vec::new(),
            )
        })
}

fn zustand_whole_store_is_store_value<'node, 'ast>(
    expression: &'node Expression<'ast>,
    factory_api_names: &[ZustandStoreFactoryApi],
    ctx: &LintContext<'ast>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression {
        return resolve_zustand_store_factory_call(call, ctx)
            .is_some_and(|factory| factory_api_names.contains(&factory.factory_api_name));
    }
    let Expression::Identifier(identifier) = expression else {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    let ZustandWholeStoreAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        ZustandWholeStoreAstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            zustand_whole_store_is_store_value(
                initializer,
                factory_api_names,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn zustand_whole_store_is_direct_render_call<'a>(
    node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    component_evidence: &mut FxHashMap<NodeId, bool>,
    property_write_analysis: &mut Option<PossibleStaticPropertyWriteAnalysis>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
) -> bool {
    let Some(render_function) = find_render_phase_component_or_hook(node, ctx) else {
        return false;
    };
    if crate::ast_util::get_enclosing_function(node, ctx).map(crate::AstNode::id)
        != Some(render_function.id())
    {
        return false;
    }
    let Some(display_name) = component_or_hook_function_name(render_function, ctx) else {
        return false;
    };
    if crate::utils::is_react_hook_name(display_name) {
        return true;
    }
    *component_evidence
        .entry(render_function.id())
        .or_insert_with(|| {
            if function_contains_react_render_output(render_function, ctx) {
                return true;
            }
            let analysis = property_write_analysis
                .get_or_insert_with(|| build_possible_static_property_write_analysis(ctx));
            zustand_whole_store_function_returns_props_children(
                render_function,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
            ) || (zustand_whole_store_function_contains_react_hook_call(
                render_function,
                node_index,
                ctx,
            ) && zustand_whole_store_function_returns_only_null(
                render_function,
                node_index,
                ctx,
            ))
        })
}

fn zustand_whole_store_function_return_expressions<'a>(
    function_node: &crate::AstNode<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    if let ZustandWholeStoreAstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression];
    }
    node_index
        .node_ids(function_node.id())
        .iter()
        .filter_map(|&candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            let ZustandWholeStoreAstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            statement.argument.as_ref()
        })
        .collect()
}

fn zustand_whole_store_function_returns_only_null(
    function_node: &crate::AstNode<'_>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    if let ZustandWholeStoreAstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return matches!(
            expression.get_inner_expression(),
            Expression::NullLiteral(_)
        );
    }
    let mut has_return = false;
    for &candidate_id in node_index.node_ids(function_node.id()) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let ZustandWholeStoreAstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        let Some(expression) = statement.argument.as_ref() else {
            return false;
        };
        if !matches!(
            expression.get_inner_expression(),
            Expression::NullLiteral(_)
        ) {
            return false;
        }
        has_return = true;
    }
    has_return
}

fn zustand_whole_store_function_contains_react_hook_call(
    function_node: &crate::AstNode<'_>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    node_index
        .node_ids(function_node.id())
        .iter()
        .any(|&candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            let ZustandWholeStoreAstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            !ctx.nodes()
                .ancestors(candidate.id())
                .take_while(|ancestor| ancestor.id() != function_node.id())
                .any(|ancestor| matches!(ancestor.kind(), ZustandWholeStoreAstKind::Class(_)))
                && REACT_HOOK_NAMES.iter().any(|hook_name| {
                    !zustand_whole_store_is_global_react_hook_call(call, hook_name, ctx)
                        && is_react_api_call(call, hook_name, ctx)
                })
        })
}

fn zustand_whole_store_is_global_react_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    hook_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression() {
        return static_member_expression_property_name(member) == Some(hook_name)
            && zustand_whole_store_resolves_to_global_react_namespace(
                member.object(),
                ctx,
                &mut Vec::new(),
            );
    }
    let Expression::Identifier(identifier) = callee else {
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
    let ZustandWholeStoreAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        !property.computed
            && property_key_matches_name(&property.key, hook_name)
            && matches!(
                &property.value,
                BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id
            )
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        zustand_whole_store_resolves_to_global_react_namespace(initializer, ctx, &mut Vec::new())
    })
}

fn zustand_whole_store_resolves_to_global_react_namespace<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return identifier.name == "React";
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let ZustandWholeStoreAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        ZustandWholeStoreAstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            zustand_whole_store_resolves_to_global_react_namespace(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn zustand_whole_store_function_returns_props_children<'a>(
    function_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
) -> bool {
    let parameters = match function_node.kind() {
        ZustandWholeStoreAstKind::Function(function) => &function.params,
        ZustandWholeStoreAstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let first_parameter = match &first_parameter.pattern {
        BindingPattern::AssignmentPattern(assignment) => &assignment.left,
        pattern => pattern,
    };
    let mut props_symbol_id = None;
    let mut children_symbol_ids = Vec::new();
    match first_parameter {
        BindingPattern::BindingIdentifier(identifier) => {
            props_symbol_id = Some(identifier.symbol_id());
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                if !zustand_whole_store_property_key_is_children(&property.key, property.computed) {
                    continue;
                }
                let binding = match &property.value {
                    BindingPattern::AssignmentPattern(assignment) => {
                        assignment.left.get_binding_identifier()
                    }
                    pattern => pattern.get_binding_identifier(),
                };
                if let Some(binding) = binding {
                    children_symbol_ids.push(binding.symbol_id());
                }
            }
        }
        _ => {}
    }
    zustand_whole_store_function_return_expressions(function_node, node_index, ctx)
        .into_iter()
        .any(|expression| {
            zustand_whole_store_expression_returns_props_children(
                expression,
                props_symbol_id,
                &children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                &mut Vec::new(),
                &mut Vec::new(),
            )
        })
}

fn zustand_whole_store_expression_returns_props_children<'a>(
    expression: &'a Expression<'a>,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let expression_id = expression.node_id();
    if visited_expression_ids.contains(&expression_id) {
        return false;
    }
    visited_expression_ids.push(expression_id);
    let matches = zustand_whole_store_expression_returns_props_children_inner(
        expression,
        props_symbol_id,
        children_symbol_ids,
        analysis,
        node_index,
        ctx,
        assigned_expression_cache,
        visited_expression_ids,
        visited_function_ids,
    );
    visited_expression_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn zustand_whole_store_expression_returns_props_children_inner<'a>(
    expression: &'a Expression<'a>,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if children_symbol_ids.contains(&symbol_id) {
            return !symbol_has_write_before(symbol_id, identifier.span.start, ctx);
        }
        return resolve_cfg_assigned_expressions_for_reference(
            identifier,
            symbol_id,
            ctx,
            assigned_expression_cache,
        )
        .into_iter()
        .any(|assigned_expression| {
            if matches!(
                assigned_expression.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                return false;
            }
            zustand_whole_store_expression_returns_props_children(
                assigned_expression,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        });
    }
    if let Some(member) = expression.as_member_expression()
        && static_member_expression_property_name(member) == Some("children")
        && let Expression::Identifier(receiver) = member.object().get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
    {
        let member_node = ctx.nodes().get_node(expression.node_id());
        return props_symbol_id == Some(symbol_id)
            && !symbol_has_write_before(symbol_id, receiver.span.start, ctx)
            && !has_possible_static_property_write_before(
                receiver,
                "children",
                member_node,
                analysis,
                ctx,
            );
    }
    if let Expression::CallExpression(call) = expression {
        if !call.arguments.is_empty() {
            return false;
        }
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        let Some(function_id) = zustand_whole_store_zero_argument_local_function_id(callee, ctx)
        else {
            return false;
        };
        return zustand_whole_store_function_returns_props_children_expression(
            function_id,
            props_symbol_id,
            children_symbol_ids,
            analysis,
            node_index,
            ctx,
            assigned_expression_cache,
            visited_expression_ids,
            visited_function_ids,
        );
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            zustand_whole_store_expression_returns_props_children(
                &conditional.consequent,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) || zustand_whole_store_expression_returns_props_children(
                &conditional.alternate,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        Expression::LogicalExpression(logical) => {
            zustand_whole_store_expression_returns_props_children(
                &logical.left,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) || zustand_whole_store_expression_returns_props_children(
                &logical.right,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        _ => false,
    }
}

fn zustand_whole_store_zero_argument_local_function_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    if let ZustandWholeStoreAstKind::Function(function) = declaration.kind()
        && function.r#type == FunctionType::FunctionDeclaration
        && !function.r#async
        && !function.generator
        && function.params.items.is_empty()
    {
        return Some(declaration.id());
    }
    let ZustandWholeStoreAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        ZustandWholeStoreAstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    match declarator.init.as_ref()?.get_inner_expression() {
        Expression::ArrowFunctionExpression(function)
            if !function.r#async && function.params.items.is_empty() =>
        {
            Some(function.node_id.get())
        }
        Expression::FunctionExpression(function)
            if !function.r#async && !function.generator && function.params.items.is_empty() =>
        {
            Some(function.node_id.get())
        }
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
fn zustand_whole_store_function_returns_props_children_expression<'a>(
    function_id: NodeId,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut PossibleAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    let function_node = ctx.nodes().get_node(function_id);
    let matches = zustand_whole_store_function_return_expressions(function_node, node_index, ctx)
        .into_iter()
        .any(|expression| {
            zustand_whole_store_expression_returns_props_children(
                expression,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        });
    visited_function_ids.pop();
    matches
}

fn zustand_whole_store_property_key_is_children(
    property_key: &oxc_ast::ast::PropertyKey<'_>,
    is_computed: bool,
) -> bool {
    if !is_computed {
        return property_key_matches_name(property_key, "children");
    }
    matches!(
        property_key,
        oxc_ast::ast::PropertyKey::StringLiteral(literal) if literal.value == "children"
    ) || matches!(
        property_key,
        oxc_ast::ast::PropertyKey::TemplateLiteral(template)
            if template.expressions.is_empty()
                && template.quasis.first().is_some_and(|quasi| {
                    quasi.value.cooked.as_ref().map_or(
                        quasi.value.raw.as_str(),
                        |cooked| cooked.as_str(),
                    ) == "children"
                })
    )
}
