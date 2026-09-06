use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This ref is already attached by R3F through JSX. Adding or attaching ref.current imperatively creates competing scene-graph ownership";
const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_OBJECT3D_CONSTRUCTOR_NAMES: [&str; 24] = [
    "ArrayCamera",
    "BatchedMesh",
    "Bone",
    "Camera",
    "CubeCamera",
    "DirectionalLight",
    "Group",
    "HemisphereLight",
    "InstancedMesh",
    "Light",
    "Line",
    "LineLoop",
    "LineSegments",
    "LOD",
    "Mesh",
    "Object3D",
    "OrthographicCamera",
    "PerspectiveCamera",
    "PointLight",
    "Points",
    "Scene",
    "SkinnedMesh",
    "SpotLight",
    "Sprite",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoImperativeAttachOfManagedRef;

impl RuleMeta for R3FNoImperativeAttachOfManagedRef {
    const NAME: &'static str = "r3f-no-imperative-attach-of-managed-ref";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow imperative attachment of refs already managed by R3F.",
    };
}

impl Rule for R3FNoImperativeAttachOfManagedRef {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let managed_ref_symbol_ids = collect_r3f_host_ref_symbol_ids(ctx);
        if managed_ref_symbol_ids.is_empty() {
            return;
        }
        let attachments = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                managed_ref_attachment(node, ctx)
                    .map(|(ref_symbol_id, receiver)| (node, ref_symbol_id, receiver))
            })
            .collect::<Vec<_>>();
        if attachments.is_empty() {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let frame_callback_ids =
            collect_managed_ref_frame_callback_ids(&analysis, ctx, &mut resolution_cache);
        for (node, ref_symbol_id, receiver) in attachments {
            if managed_ref_symbol_ids.contains(&ref_symbol_id)
                && managed_ref_scene_ownership_provenance(
                    receiver,
                    &frame_callback_ids,
                    &managed_ref_symbol_ids,
                    &analysis,
                    ctx,
                    &mut resolution_cache,
                )
            {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(node.span()));
            }
        }
    }
}

fn managed_ref_attachment<'a, 'b>(
    node: &'b crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(oxc_semantic::SymbolId, &'b oxc_ast::ast::Expression<'a>)> {
    let AstKind::CallExpression(call_expression) = node.kind() else {
        return None;
    };
    let member_expression = call_expression.callee.as_member_expression()?;
    if !matches!(
        member_expression.static_property_name(),
        Some("add" | "attach")
    ) {
        return None;
    }
    call_expression
        .arguments
        .iter()
        .filter_map(oxc_ast::ast::Argument::as_expression)
        .find_map(|argument| {
            let symbol_id = managed_ref_current_symbol(argument, ctx)?;
            Some((symbol_id, member_expression.object()))
        })
}

fn managed_ref_scene_ownership_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    frame_callback_ids: &[oxc_semantic::NodeId],
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if managed_ref_current_symbol(expression, ctx)
        .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
        || managed_ref_has_use_three_scene_provenance(
            expression,
            analysis,
            ctx,
            &mut Vec::new(),
            resolution_cache,
        )
        || frame_callback_ids
            .iter()
            .any(|callback_id| managed_ref_frame_state_scene_matches(expression, *callback_id, ctx))
    {
        return true;
    }
    managed_ref_has_three_object_provenance(expression, analysis, ctx, &mut Vec::new())
}

fn managed_ref_has_three_object_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::NewExpression(new_expression) = expression {
        return THREE_OBJECT3D_CONSTRUCTOR_NAMES
            .iter()
            .any(|constructor_name| {
                module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_MODULES,
                    analysis,
                    ctx,
                )
            });
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    declarator.init.as_ref().is_some_and(|initializer| {
        managed_ref_has_three_object_provenance(initializer, analysis, ctx, visited_symbol_ids)
    })
}

fn managed_ref_has_use_three_scene_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
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
    let is_direct_binding = declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id);
    let (is_scene_binding, effective_initializer) =
        managed_ref_binding_details(&declarator.id, symbol_id, declarator.init.as_ref())
            .unwrap_or((false, None));
    if effective_initializer.is_some_and(|initializer| {
            matches!(initializer.get_inner_expression(), oxc_ast::ast::Expression::CallExpression(call_expression)
                if managed_ref_use_three_selects_scene(
                    call_expression,
                    analysis,
                    ctx,
                    resolution_cache,
                ))
        })
    {
        return true;
    }
    if is_scene_binding
        && effective_initializer.is_some_and(|initializer| {
            matches!(initializer.get_inner_expression(), oxc_ast::ast::Expression::CallExpression(call_expression)
                if module_api_reference_matches(
                    &call_expression.callee,
                    "useThree",
                    &R3F_PUBLIC_MODULES,
                    analysis,
                    ctx,
                ))
        })
    {
        return true;
    }
    if !is_direct_binding
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        )
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let matches = effective_initializer.is_some_and(|initializer| {
        managed_ref_has_use_three_scene_provenance(
            initializer,
            analysis,
            ctx,
            visited_symbol_ids,
            resolution_cache,
        )
    });
    visited_symbol_ids.pop();
    matches
}

fn managed_ref_binding_details<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a oxc_ast::ast::Expression<'a>>,
) -> Option<(bool, Option<&'a oxc_ast::ast::Expression<'a>>)> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier) => {
            (binding_identifier.symbol_id() == symbol_id).then_some((false, base_initializer))
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            managed_ref_binding_details(&assignment.left, symbol_id, Some(&assignment.right))
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                match &property.value {
                    oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                        if binding_identifier.symbol_id() == symbol_id =>
                    {
                        return Some((
                            managed_ref_property_key_matches_scene(&property.key),
                            base_initializer,
                        ));
                    }
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment)
                        if assignment.left.get_binding_identifier().is_some_and(
                            |binding_identifier| binding_identifier.symbol_id() == symbol_id,
                        ) =>
                    {
                        return Some((
                            managed_ref_property_key_matches_scene(&property.key),
                            Some(&assignment.right),
                        ));
                    }
                    _ => {
                        if let Some(details) = managed_ref_binding_details(
                            &property.value,
                            symbol_id,
                            base_initializer,
                        ) {
                            return Some(details);
                        }
                    }
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                managed_ref_binding_details(&rest.argument, symbol_id, base_initializer)
            })
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                if let Some(details) =
                    managed_ref_binding_details(element, symbol_id, base_initializer)
                {
                    return Some(details);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                managed_ref_binding_details(&rest.argument, symbol_id, base_initializer)
            })
        }
    }
}

fn managed_ref_property_key_matches_scene(key: &oxc_ast::ast::PropertyKey<'_>) -> bool {
    if property_key_matches_name(key, "scene") {
        return true;
    }
    let oxc_ast::ast::PropertyKey::TemplateLiteral(template) = key else {
        return false;
    };
    template.expressions.is_empty()
        && template.quasis.first().is_some_and(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                == "scene"
        })
}

fn managed_ref_use_three_selects_scene<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if !module_api_reference_matches(
        &call_expression.callee,
        "useThree",
        &R3F_PUBLIC_MODULES,
        analysis,
        ctx,
    ) {
        return false;
    }
    let Some(selector_expression) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let Some(selector_id) =
        managed_ref_callback_node_id(selector_expression, analysis, ctx, resolution_cache)
    else {
        return false;
    };
    managed_ref_function_return_expressions(selector_id, ctx)
        .into_iter()
        .any(|returned_expression| {
            managed_ref_selector_expression_selects_scene(
                returned_expression,
                selector_id,
                ctx,
                &mut Vec::new(),
                &mut Vec::new(),
            )
        })
}

fn managed_ref_selector_expression_selects_scene<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    selector_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
    visited_expression_ids: &mut Vec<oxc_semantic::NodeId>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if managed_ref_frame_state_scene_matches(expression, selector_id, ctx) {
        return true;
    }
    match expression {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let expression_id = identifier.node_id.get();
            if visited_expression_ids.contains(&expression_id) {
                return false;
            }
            visited_expression_ids.push(expression_id);
            let matches = managed_ref_possible_assigned_expressions(identifier, symbol_id, ctx)
                .into_iter()
                .any(|assigned_expression| {
                    managed_ref_selector_expression_selects_scene(
                        assigned_expression,
                        selector_id,
                        ctx,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                });
            visited_expression_ids.pop();
            matches
        }
        oxc_ast::ast::Expression::CallExpression(call_expression)
            if call_expression.arguments.is_empty() =>
        {
            let Some(function_id) =
                managed_ref_zero_argument_helper_id(&call_expression.callee, ctx)
            else {
                return false;
            };
            if visited_function_ids.contains(&function_id) {
                return false;
            }
            visited_function_ids.push(function_id);
            let matches = managed_ref_function_return_expressions(function_id, ctx)
                .into_iter()
                .any(|returned_expression| {
                    managed_ref_selector_expression_selects_scene(
                        returned_expression,
                        selector_id,
                        ctx,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                });
            visited_function_ids.pop();
            matches
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            managed_ref_selector_expression_selects_scene(
                &conditional_expression.consequent,
                selector_id,
                ctx,
                visited_expression_ids,
                visited_function_ids,
            ) || managed_ref_selector_expression_selects_scene(
                &conditional_expression.alternate,
                selector_id,
                ctx,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression) => {
            managed_ref_selector_expression_selects_scene(
                &logical_expression.left,
                selector_id,
                ctx,
                visited_expression_ids,
                visited_function_ids,
            ) || managed_ref_selector_expression_selects_scene(
                &logical_expression.right,
                selector_id,
                ctx,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        _ => false,
    }
}

fn managed_ref_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Vec<&'a oxc_ast::ast::Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return Vec::new();
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return Vec::new();
    };
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Const
            | oxc_ast::ast::VariableDeclarationKind::Let
            | oxc_ast::ast::VariableDeclarationKind::Var
    ) {
        return Vec::new();
    }
    if variable_declaration.kind.is_const() {
        return declarator.init.iter().collect();
    }
    let reference_node = ctx.nodes().get_node(identifier.node_id.get());
    let Some(function_id) = local_callback_nearest_function_id(reference_node.id(), ctx) else {
        return Vec::new();
    };
    let function_node = ctx.nodes().get_node(function_id);
    if local_callback_nearest_function_id(declaration.id(), ctx) != Some(function_id) {
        return Vec::new();
    }
    let reference_position = reference_node.span().start;
    let mut definitions = Vec::new();
    if let Some(initializer) = declarator.init.as_ref() {
        definitions.push((
            initializer,
            declaration.span().start,
            managed_ref_definition_is_conditional(declaration, ctx),
            ctx.nodes().cfg_id(declaration.id()),
        ));
    }
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let identifier_node = ctx.nodes().get_node(reference.node_id());
        if identifier_node.span().start >= reference_position
            || local_callback_nearest_function_id(identifier_node.id(), ctx) != Some(function_id)
        {
            continue;
        }
        let assignment_target_root = transparent_expression_root(identifier_node, ctx);
        let assignment_node = ctx.nodes().parent_node(assignment_target_root.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            || assignment.left.span() != assignment_target_root.span()
        {
            continue;
        }
        definitions.push((
            &assignment.right,
            assignment_target_root.span().start,
            managed_ref_definition_is_conditional(assignment_target_root, ctx),
            ctx.nodes().cfg_id(assignment_target_root.id()),
        ));
    }
    let mut definitions_by_block: rustc_hash::FxHashMap<oxc_cfg::BlockNodeId, Vec<usize>> =
        rustc_hash::FxHashMap::default();
    for (definition_id, (_, _, _, block_id)) in definitions.iter().enumerate() {
        definitions_by_block
            .entry(*block_id)
            .or_default()
            .push(definition_id);
    }
    for definition_ids in definitions_by_block.values_mut() {
        definition_ids.sort_by_key(|definition_id| definitions[*definition_id].1);
    }
    let graph = ctx.cfg().graph();
    let entry_block = ctx.nodes().cfg_id(function_node.id());
    let mut reachable_blocks = rustc_hash::FxHashSet::default();
    let mut pending_blocks = vec![entry_block];
    while let Some(block_id) = pending_blocks.pop() {
        if !reachable_blocks.insert(block_id) {
            continue;
        }
        for edge in graph.edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
            ) {
                continue;
            }
            pending_blocks.push(oxc_cfg::graph::visit::EdgeRef::target(&edge));
        }
    }
    let apply_definitions = |incoming: &rustc_hash::FxHashSet<usize>, definition_ids: &[usize]| {
        let mut outgoing = incoming.clone();
        for definition_id in definition_ids {
            if !definitions[*definition_id].2 {
                outgoing.clear();
            }
            outgoing.insert(*definition_id);
        }
        outgoing
    };
    let mut incoming_by_block: rustc_hash::FxHashMap<
        oxc_cfg::BlockNodeId,
        rustc_hash::FxHashSet<usize>,
    > = rustc_hash::FxHashMap::default();
    let mut outgoing_by_block: rustc_hash::FxHashMap<
        oxc_cfg::BlockNodeId,
        rustc_hash::FxHashSet<usize>,
    > = rustc_hash::FxHashMap::default();
    let mut did_change = true;
    while did_change {
        did_change = false;
        for block_id in &reachable_blocks {
            let mut incoming = rustc_hash::FxHashSet::default();
            for edge in graph.edges_directed(*block_id, oxc_cfg::graph::Direction::Incoming) {
                if matches!(
                    edge.weight(),
                    oxc_cfg::EdgeType::NewFunction
                        | oxc_cfg::EdgeType::Unreachable
                        | oxc_cfg::EdgeType::Error(oxc_cfg::ErrorEdgeKind::Implicit)
                ) {
                    continue;
                }
                let source = oxc_cfg::graph::visit::EdgeRef::source(&edge);
                if !reachable_blocks.contains(&source) {
                    continue;
                }
                incoming.extend(
                    outgoing_by_block
                        .get(&source)
                        .into_iter()
                        .flatten()
                        .copied(),
                );
            }
            let outgoing = apply_definitions(
                &incoming,
                definitions_by_block
                    .get(block_id)
                    .map_or(&[], Vec::as_slice),
            );
            if incoming_by_block.get(block_id) != Some(&incoming)
                || outgoing_by_block.get(block_id) != Some(&outgoing)
            {
                incoming_by_block.insert(*block_id, incoming);
                outgoing_by_block.insert(*block_id, outgoing);
                did_change = true;
            }
        }
    }
    let reference_block = ctx.nodes().cfg_id(reference_node.id());
    if !reachable_blocks.contains(&reference_block) {
        return Vec::new();
    }
    let definition_ids_before_reference = definitions_by_block
        .get(&reference_block)
        .into_iter()
        .flatten()
        .copied()
        .filter(|definition_id| definitions[*definition_id].1 < reference_position)
        .collect::<Vec<_>>();
    let empty_incoming = rustc_hash::FxHashSet::default();
    apply_definitions(
        incoming_by_block
            .get(&reference_block)
            .unwrap_or(&empty_incoming),
        &definition_ids_before_reference,
    )
    .into_iter()
    .map(|definition_id| definitions[definition_id].0)
    .collect()
}

fn managed_ref_definition_is_conditional(node: &crate::AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let block_id = ctx.nodes().cfg_id(node.id());
    for parent in ctx.nodes().ancestors(node.id()) {
        if ctx.nodes().cfg_id(parent.id()) != block_id {
            break;
        }
        if matches!(
            parent.kind(),
            AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_)
        ) {
            return true;
        }
    }
    false
}

fn managed_ref_zero_argument_helper_id<'a>(
    callee: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    let oxc_ast::ast::Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if !function.r#async && !function.generator && function.params.items.is_empty() =>
        {
            Some(declaration.id())
        }
        AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id) =>
        {
            match declarator.init.as_ref()?.get_inner_expression() {
                oxc_ast::ast::Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                oxc_ast::ast::Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn managed_ref_function_return_expressions<'a>(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Vec<&'a oxc_ast::ast::Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression];
    }
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            (local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id))
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}

fn managed_ref_frame_state_scene_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    if r3f_callback_state_property_matches(expression, callback_id, "scene", ctx) {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
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
    if managed_ref_callback_parameter_has_scene_binding(callback_id, symbol_id, ctx) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        managed_ref_property_key_matches_scene(&property.key)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        r3f_resolves_to_callback_state(initializer, callback_id, ctx, &mut Vec::new())
    })
}

fn managed_ref_callback_parameter_has_scene_binding(
    callback_id: oxc_semantic::NodeId,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(parameter) = r3f_callback_first_parameter(callback_id, ctx) else {
        return false;
    };
    let parameter = match parameter {
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => &assignment.left,
        parameter => parameter,
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = parameter else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        managed_ref_property_key_matches_scene(&property.key)
            && r3f_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    })
}

fn managed_ref_current_symbol<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let member_expression = expression.get_inner_expression().as_member_expression()?;
    if member_expression.static_property_name() != Some("current") {
        return None;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    managed_ref_symbol_is_react_ref(symbol_id, ctx).then_some(symbol_id)
}

fn managed_ref_symbol_is_react_ref(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(oxc_ast::ast::Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return false;
    };
    is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx)
}

fn collect_managed_ref_frame_callback_ids(
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                return None;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_PUBLIC_MODULES,
                analysis,
                ctx,
            ) {
                return None;
            }
            let callback_expression = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)?;
            managed_ref_callback_node_id(callback_expression, analysis, ctx, resolution_cache)
        })
        .collect()
}

fn managed_ref_callback_node_id<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if let Some(function_id) =
        managed_ref_exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    {
        return Some(function_id);
    }
    let wrapper_call = managed_ref_callback_wrapper_call(expression, ctx, &mut Vec::new())?;
    if !managed_ref_react_use_callback_matches(wrapper_call, analysis, ctx) {
        return None;
    }
    let callback = wrapper_call.arguments.first()?.as_expression()?;
    managed_ref_exact_local_function_id(callback, ctx, &mut Vec::new(), resolution_cache)
}

fn managed_ref_exact_local_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::FunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::Function(_) = declaration.kind() {
                return (!cached_symbol_has_write(symbol_id, ctx, resolution_cache))
                    .then_some(declaration.id());
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
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return None;
            }
            managed_ref_exact_local_function_id(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
                resolution_cache,
            )
        }
        _ => exact_local_function_id(expression, ctx, visited_symbol_ids, resolution_cache),
    }
}

fn managed_ref_callback_wrapper_call<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        return Some(call_expression);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
    let declaration = ctx.symbol_declaration(symbol_id);
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
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    managed_ref_callback_wrapper_call(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn managed_ref_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    managed_ref_direct_react_use_callback_matches(call_expression, ctx)
        || module_api_reference_matches(
            &call_expression.callee,
            "useCallback",
            &REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn managed_ref_direct_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if callee.as_member_expression().is_some() {
        return is_react_api_call(call_expression, "useCallback", ctx)
            && !managed_ref_is_global_react_namespace_call(call_expression, ctx);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "useCallback"
            )
    })
}

fn managed_ref_is_global_react_namespace_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}
