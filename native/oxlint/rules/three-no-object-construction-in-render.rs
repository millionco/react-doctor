use oxc_ast::ast::{AssignmentTarget, BindingPattern, Expression, FunctionType, JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE_SUFFIX: &str = "creates a fresh mutable Three.js object during this render. Move it to useMemo, a lazy useState initializer, an initialized-once ref, or module scope";
const THREE_CONSTRUCTION_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const REACT_BUILTIN_HOOK_NAMES: [&str; 16] = [
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
pub struct ThreeNoObjectConstructionInRender;

impl RuleMeta for ThreeNoObjectConstructionInRender {
    const NAME: &'static str = "three-no-object-construction-in-render";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow constructing Three.js objects during React render.",
    };
}

impl Rule for ThreeNoObjectConstructionInRender {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let construction_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(node.kind(), AstKind::NewExpression(_)).then_some(node.id())
            })
            .collect::<Vec<_>>();
        if construction_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let three_constructions = construction_ids
            .into_iter()
            .filter_map(|construction_id| {
                let AstKind::NewExpression(construction) =
                    ctx.nodes().get_node(construction_id).kind()
                else {
                    return None;
                };
                three_construction_api_name(&construction.callee, &analysis, ctx)
                    .map(|api_name| (construction_id, api_name))
            })
            .collect::<Vec<_>>();
        if three_constructions.is_empty() {
            return;
        }

        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let jsx_element_symbol_ids = ctx
            .nodes()
            .iter()
            .filter_map(|candidate| {
                let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
                    return None;
                };
                let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
                    return None;
                };
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
            })
            .collect::<rustc_hash::FxHashSet<_>>();
        let mut component_evidence_cache = rustc_hash::FxHashMap::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        for (construction_id, api_name) in three_constructions {
            let construction = ctx.nodes().get_node(construction_id);
            let Some(render_owner) = find_render_phase_component_or_hook(construction, ctx) else {
                continue;
            };
            if is_inside_stable_react_initializer(construction, ctx) {
                continue;
            }
            let Some(render_owner_name) = component_or_hook_function_name(render_owner, ctx) else {
                continue;
            };
            let has_component_evidence = crate::utils::is_react_hook_name(render_owner_name)
                || *component_evidence_cache
                    .entry(render_owner.id())
                    .or_insert_with(|| {
                        three_construction_function_has_component_evidence(
                            render_owner,
                            &analysis,
                            &node_index,
                            ctx,
                            &mut assigned_expression_cache,
                        ) || three_construction_function_is_referenced_as_jsx_element(
                            render_owner,
                            &jsx_element_symbol_ids,
                            ctx,
                        )
                    });
            if !has_component_evidence {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!("new {api_name}() {MESSAGE_SUFFIX}"))
                    .with_label(construction.span()),
            );
        }
    }
}

fn three_construction_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = three_construction_api_candidate_name(expression, ctx, &mut Vec::new())?;
    (module_api_reference_matches(
        expression,
        &api_name,
        &THREE_CONSTRUCTION_MODULES,
        analysis,
        ctx,
    ) || type_import_module_api_reference_matches(
        expression,
        &api_name,
        &THREE_CONSTRUCTION_MODULES,
        analysis,
        ctx,
    ))
    .then_some(api_name)
}

fn three_construction_api_candidate_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return static_member_expression_property_name(member_expression).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_construction_api_candidate_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}

fn three_construction_function_has_component_evidence<'a>(
    function_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    function_contains_react_render_output(function_node, ctx)
        || three_construction_function_returns_props_children(
            function_node,
            analysis,
            node_index,
            ctx,
            assigned_expression_cache,
        )
        || (three_construction_function_contains_react_hook_call(function_node, node_index, ctx)
            && three_construction_function_returns_only_null(function_node, node_index, ctx))
}

fn three_construction_function_return_expressions<'a>(
    function_node: &crate::AstNode<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(arrow_function) = function_node.kind()
        && let Some(expression) = arrow_function.get_expression()
    {
        return vec![expression];
    }
    node_index
        .node_ids(function_node.id())
        .iter()
        .filter_map(|&candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            return_statement.argument.as_ref()
        })
        .collect()
}

fn three_construction_function_returns_only_null<'a>(
    function_node: &crate::AstNode<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::ArrowFunctionExpression(arrow_function) = function_node.kind()
        && let Some(expression) = arrow_function.get_expression()
    {
        return matches!(
            expression.get_inner_expression(),
            Expression::NullLiteral(_)
        );
    }
    let mut has_return = false;
    for &candidate_id in node_index.node_ids(function_node.id()) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(expression) = return_statement.argument.as_ref() else {
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

fn three_construction_function_contains_react_hook_call<'a>(
    function_node: &crate::AstNode<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    node_index
        .node_ids(function_node.id())
        .iter()
        .any(|&candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return false;
            };
            REACT_BUILTIN_HOOK_NAMES.iter().any(|hook_name| {
                !three_construction_is_global_react_hook_call(call_expression, hook_name, ctx)
                    && is_react_api_call(call_expression, hook_name, ctx)
            })
        })
}

fn three_construction_is_global_react_hook_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    hook_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member_expression) = callee.as_member_expression() {
        return static_member_expression_property_name(member_expression) == Some(hook_name)
            && three_construction_resolves_to_global_react_namespace(
                member_expression.object(),
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
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
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
        three_construction_resolves_to_global_react_namespace(initializer, ctx, &mut Vec::new())
    })
}

fn three_construction_resolves_to_global_react_namespace<'a>(
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
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_construction_resolves_to_global_react_namespace(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_construction_function_returns_props_children<'a>(
    function_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    let Some(parameters) = (match function_node.kind() {
        AstKind::Function(function) => Some(&function.params),
        AstKind::ArrowFunctionExpression(arrow_function) => Some(&arrow_function.params),
        _ => None,
    }) else {
        return false;
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let first_parameter_pattern = match &first_parameter.pattern {
        BindingPattern::AssignmentPattern(pattern) => &pattern.left,
        pattern => pattern,
    };
    let mut props_symbol_id = None;
    let mut children_symbol_ids = Vec::new();
    match first_parameter_pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            props_symbol_id = Some(identifier.symbol_id());
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                if !three_construction_property_key_is_children(&property.key, property.computed) {
                    continue;
                }
                if let Some(identifier) =
                    three_construction_binding_pattern_identifier(&property.value)
                {
                    children_symbol_ids.push(identifier.symbol_id());
                }
            }
        }
        _ => {}
    }
    three_construction_function_return_expressions(function_node, node_index, ctx)
        .into_iter()
        .any(|expression| {
            three_construction_expression_returns_props_children(
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

fn three_construction_binding_pattern_identifier<'a>(
    pattern: &'a BindingPattern<'a>,
) -> Option<&'a oxc_ast::ast::BindingIdentifier<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier),
        BindingPattern::AssignmentPattern(assignment) => {
            three_construction_binding_pattern_identifier(&assignment.left)
        }
        _ => None,
    }
}

fn three_construction_expression_returns_props_children<'a>(
    expression: &'a Expression<'a>,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    let expression_id = expression.node_id();
    if visited_expression_ids.contains(&expression_id) {
        return false;
    }
    visited_expression_ids.push(expression_id);
    let matches = three_construction_expression_returns_props_children_inner(
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
fn three_construction_expression_returns_props_children_inner<'a>(
    expression: &'a Expression<'a>,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
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
        return r3f_analyzed_possible_assigned_expressions(
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
            three_construction_expression_returns_props_children(
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
    if let Some(member_expression) = expression.as_member_expression() {
        if static_member_expression_property_name(member_expression) != Some("children") {
            return false;
        }
        let Expression::Identifier(receiver) = member_expression.object().get_inner_expression()
        else {
            return false;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
        else {
            return false;
        };
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
    if let Expression::CallExpression(call_expression) = expression {
        if !call_expression.arguments.is_empty() {
            return false;
        }
        let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
            return false;
        };
        let Some(function_id) = three_construction_zero_argument_local_function_id(callee, ctx)
        else {
            return false;
        };
        return three_construction_function_returns_props_children_expression(
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
            three_construction_expression_returns_props_children(
                &conditional.consequent,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) || three_construction_expression_returns_props_children(
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
            three_construction_expression_returns_props_children(
                &logical.left,
                props_symbol_id,
                children_symbol_ids,
                analysis,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) || three_construction_expression_returns_props_children(
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

fn three_construction_zero_argument_local_function_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::Function(function) = declaration.kind()
        && function.r#type == FunctionType::FunctionDeclaration
        && !function.r#async
        && !function.generator
        && function.params.items.is_empty()
    {
        return Some(declaration.id());
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
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
fn three_construction_function_returns_props_children_expression<'a>(
    function_id: NodeId,
    props_symbol_id: Option<SymbolId>,
    children_symbol_ids: &[SymbolId],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<NodeId>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    let function_node = ctx.nodes().get_node(function_id);
    let return_expressions =
        three_construction_function_return_expressions(function_node, node_index, ctx);
    let matches = return_expressions.into_iter().any(|return_expression| {
        three_construction_expression_returns_props_children(
            return_expression,
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

fn three_construction_property_key_is_children(
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

fn three_construction_function_is_referenced_as_jsx_element<'a>(
    function_node: &crate::AstNode<'a>,
    jsx_element_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    three_construction_function_binding_symbol_id(function_node, ctx)
        .is_some_and(|symbol_id| jsx_element_symbol_ids.contains(&symbol_id))
}

fn three_construction_function_binding_symbol_id<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
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
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == function_root.span() =>
        {
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        AstKind::CallExpression(_) => {
            let call_root = transparent_expression_root(parent, ctx);
            let call_parent = ctx.nodes().parent_node(call_root.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        }
        _ => None,
    }
}
