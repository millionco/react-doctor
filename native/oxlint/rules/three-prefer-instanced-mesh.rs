use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This map adds multiple Mesh objects with the same geometry and material, creating a draw call for each item. Use one InstancedMesh and set each instance transform";
const THREE_OBJECT_CONTAINER_NAMES: [&str; 4] = ["Group", "Mesh", "Object3D", "Scene"];

#[derive(Debug, Default, Clone)]
pub struct ThreePreferInstancedMesh;

struct ThreeInstancedMeshIdentifierIndex {
    node_ids_by_start: Vec<NodeId>,
}

impl ThreeInstancedMeshIdentifierIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut node_ids_by_start = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(node.kind(), AstKind::IdentifierReference(_)).then_some(node.id())
            })
            .collect::<Vec<_>>();
        node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self { node_ids_by_start }
    }
}

impl RuleMeta for ThreePreferInstancedMesh {
    const NAME: &'static str = "three-prefer-instanced-mesh";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer instanced meshes for repeated Three.js meshes.",
    };
}

impl Rule for ThreePreferInstancedMesh {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::NewExpression(allocation) = node.kind() else {
                    return None;
                };
                (three_module_api_name(&allocation.callee, ctx).as_deref() == Some("Mesh"))
                    .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if candidate_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let repeated_map_ids_by_callback =
            three_instanced_mesh_repeated_map_ids_by_callback(ctx, &mut resolution_cache);
        if repeated_map_ids_by_callback.is_empty() {
            return;
        }
        let identifier_index = ThreeInstancedMeshIdentifierIndex::new(ctx);
        for candidate_id in candidate_ids {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::NewExpression(allocation) = candidate.kind() else {
                continue;
            };
            let Some(callback) = crate::ast_util::get_enclosing_function(candidate, ctx) else {
                continue;
            };
            let callback_id = callback.id();
            let Some(geometry) = allocation
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(material) = allocation
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let repeated_map_ids = repeated_map_ids_by_callback
                .get(&callback_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            if repeated_map_ids.is_empty()
                || is_node_conditionally_executed(candidate, callback_id, ctx)
                || !three_instanced_mesh_reference_is_stable(
                    geometry,
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &identifier_index,
                )
                || !three_instanced_mesh_reference_is_stable(
                    material,
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &identifier_index,
                )
                || three_instanced_mesh_has_incompatible_mutation(
                    candidate_id,
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                )
            {
                continue;
            }
            let is_added_directly = three_instanced_mesh_local_value_reference_ids(candidate, ctx)
                .into_iter()
                .any(|reference_id| {
                    three_instanced_mesh_reference_is_unconditionally_added(
                        reference_id,
                        callback_id,
                        ctx,
                    )
                });
            let is_returned_by_added_map = three_instanced_mesh_function_returns_node_on_every_path(
                callback_id,
                candidate_id,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut assigned_expression_cache,
                &mut Vec::new(),
            ) && repeated_map_ids
                .iter()
                .any(|map_id| three_instanced_mesh_map_is_spread_into_add(*map_id, ctx));
            if is_added_directly || is_returned_by_added_map {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
            }
        }
    }
}

fn three_instanced_mesh_repeated_map_ids_by_callback(
    ctx: &LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> rustc_hash::FxHashMap<NodeId, Vec<NodeId>> {
    let mut repeated_map_ids_by_callback = rustc_hash::FxHashMap::default();
    for node in ctx.nodes().iter() {
        let repeated_map_callback_id = (|| {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                return None;
            };
            let Expression::StaticMemberExpression(member_expression) = &call_expression.callee
            else {
                return None;
            };
            if member_expression.property.name != "map" {
                return None;
            }
            let Expression::ArrayExpression(array_expression) =
                member_expression.object.get_inner_expression()
            else {
                return None;
            };
            if array_expression.elements.len() < 2
                || array_expression.elements.iter().any(|element| {
                    matches!(
                        element,
                        ArrayExpressionElement::SpreadElement(_)
                            | ArrayExpressionElement::Elision(_)
                    )
                })
            {
                return None;
            }
            let callback_expression = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)?;
            exact_local_function_id(callback_expression, ctx, &mut Vec::new(), resolution_cache)
        })();
        let Some(repeated_map_callback_id) = repeated_map_callback_id else {
            continue;
        };
        repeated_map_ids_by_callback
            .entry(repeated_map_callback_id)
            .or_insert_with(Vec::new)
            .push(node.id());
    }
    repeated_map_ids_by_callback
}

fn three_instanced_mesh_is_three_add_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    static_member_expression_property_name(member_expression) == Some("add")
        && three_constructor_name(
            member_expression.object(),
            &THREE_OBJECT_CONTAINER_NAMES,
            ctx,
        )
        .is_some()
}

fn three_instanced_mesh_reference_is_unconditionally_added(
    reference_id: NodeId,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let expression_root = transparent_expression_root(ctx.nodes().get_node(reference_id), ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    matches!(parent.kind(), AstKind::CallExpression(call_expression)
        if three_instanced_mesh_is_three_add_call(call_expression, ctx)
            && call_expression.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    argument.get_inner_expression().node_id() == expression_root.id()
                })
            })
            && !is_node_conditionally_executed(expression_root, callback_id, ctx))
}

fn three_instanced_mesh_map_is_spread_into_add(map_id: NodeId, ctx: &LintContext<'_>) -> bool {
    three_instanced_mesh_local_value_reference_ids(ctx.nodes().get_node(map_id), ctx)
        .into_iter()
        .any(|reference_id| {
            let expression_root =
                transparent_expression_root(ctx.nodes().get_node(reference_id), ctx);
            let spread = ctx.nodes().parent_node(expression_root.id());
            let AstKind::SpreadElement(spread_element) = spread.kind() else {
                return false;
            };
            if spread_element.argument.get_inner_expression().node_id() != expression_root.id() {
                return false;
            }
            let call = ctx.nodes().parent_node(spread.id());
            matches!(call.kind(), AstKind::CallExpression(call_expression)
                if three_instanced_mesh_is_three_add_call(call_expression, ctx))
        })
}

fn three_instanced_mesh_local_value_reference_ids(
    expression_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<NodeId> {
    let mut reference_ids = rustc_hash::FxHashSet::default();
    let mut pending_ids = vec![expression_node.id()];
    while let Some(pending_id) = pending_ids.pop() {
        if !reference_ids.insert(pending_id) {
            continue;
        }
        let expression_root = transparent_expression_root(ctx.nodes().get_node(pending_id), ctx);
        let declarator_node = ctx.nodes().parent_node(expression_root.id());
        let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
            continue;
        };
        if declarator.init.as_ref().is_none_or(|initializer| {
            initializer.get_inner_expression().node_id() != expression_root.id()
        }) {
            continue;
        }
        let Some(binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        if !matches!(ctx.nodes().parent_node(declarator_node.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const())
        {
            continue;
        }
        pending_ids.extend(
            ctx.scoping()
                .get_resolved_references(binding.symbol_id())
                .map(|reference| reference.node_id()),
        );
    }
    reference_ids
}

#[allow(clippy::too_many_arguments)]
fn three_instanced_mesh_has_incompatible_mutation<'a>(
    candidate_id: NodeId,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mesh_keys =
        three_instanced_mesh_local_value_reference_ids(ctx.nodes().get_node(candidate_id), ctx)
            .into_iter()
            .filter_map(|reference_id| {
                let AstKind::IdentifierReference(identifier) =
                    ctx.nodes().get_node(reference_id).kind()
                else {
                    return None;
                };
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .map(|symbol_id| format!("symbol:{}", symbol_id.index()))
            })
            .collect::<rustc_hash::FxHashSet<_>>();
    if mesh_keys.is_empty() {
        return false;
    }
    let incompatible_resource_keys = mesh_keys
        .iter()
        .flat_map(|mesh_key| {
            [
                format!("{mesh_key}.geometry"),
                format!("{mesh_key}.material"),
            ]
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    let mut has_incompatible_mutation = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |node, _, _, _| {
            if has_incompatible_mutation {
                return;
            }
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    if assignment
                        .left
                        .get_expression()
                        .and_then(|target| resolve_expression_key(target, ctx, &mut Vec::new()))
                        .is_some_and(|target_key| incompatible_resource_keys.contains(&target_key))
                    {
                        has_incompatible_mutation = true;
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        return;
                    };
                    let Some(method_name) =
                        static_member_expression_property_name(member_expression)
                    else {
                        return;
                    };
                    if ["add", "attach", "copy"].contains(&method_name)
                        && resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
                            .is_some_and(|receiver_key| mesh_keys.contains(&receiver_key))
                    {
                        has_incompatible_mutation = true;
                    }
                }
                _ => {}
            }
        },
    );
    has_incompatible_mutation
}

#[allow(clippy::too_many_arguments)]
fn three_instanced_mesh_reference_is_stable<'a>(
    expression: &'a Expression<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    identifier_index: &ThreeInstancedMeshIdentifierIndex,
) -> bool {
    let expression = expression.get_inner_expression();
    if !matches!(
        expression,
        Expression::Identifier(_)
            | Expression::ComputedMemberExpression(_)
            | Expression::StaticMemberExpression(_)
            | Expression::PrivateFieldExpression(_)
    ) {
        return false;
    }
    let Some(expression_key) = resolve_expression_key(expression, ctx, &mut Vec::new()) else {
        return false;
    };
    if expression.as_member_expression().is_some()
        && three_instanced_mesh_has_unstable_local_member_source(expression, ctx)
    {
        return false;
    }
    let mut is_written = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if is_written {
                return;
            }
            let write_expression = match candidate.kind() {
                AstKind::AssignmentExpression(assignment) => assignment.left.get_expression(),
                AstKind::UpdateExpression(update) => update.argument.get_expression(),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    Some(&unary.argument)
                }
                _ => None,
            };
            if write_expression.is_some_and(|write_expression| {
                resolve_expression_key(write_expression, ctx, &mut Vec::new()).is_some_and(
                    |write_key| {
                        write_key == expression_key
                            || expression_key.starts_with(&format!("{write_key}."))
                    },
                )
            }) {
                is_written = true;
            }
        },
    );
    if is_written {
        return false;
    }
    let expression_span = expression.span();
    let first_candidate_index = identifier_index
        .node_ids_by_start
        .partition_point(|node_id| {
            ctx.nodes().get_node(*node_id).span().start < expression_span.start
        });
    for candidate_id in &identifier_index.node_ids_by_start[first_candidate_index..] {
        let candidate = ctx.nodes().get_node(*candidate_id);
        if candidate.span().start > expression_span.end {
            break;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !three_instanced_mesh_node_is_within_span(candidate, expression_span) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if three_instanced_mesh_node_is_within(ctx.symbol_declaration(symbol_id), callback_id, ctx)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    reference.is_write()
                        && three_instanced_mesh_node_is_within(
                            ctx.nodes().get_node(reference.node_id()),
                            callback_id,
                            ctx,
                        )
                })
        {
            return false;
        }
    }
    true
}

fn three_instanced_mesh_has_unstable_local_member_source<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut property_names = Vec::new();
    while let Some(member_expression) = current.as_member_expression() {
        let Some(property_name) = member_expression.static_property_name() else {
            return false;
        };
        property_names.push(property_name);
        current = member_expression.object().get_inner_expression();
    }
    property_names.reverse();
    let Some(mut object_expression) = three_instanced_mesh_local_object_expression(current, ctx)
    else {
        return false;
    };
    let Some(final_property_name) = property_names.pop() else {
        return false;
    };
    for property_name in property_names {
        let Some(property_value) =
            get_static_object_property_value(object_expression, property_name)
        else {
            return true;
        };
        let Some(next_object_expression) =
            three_instanced_mesh_local_object_expression(property_value, ctx)
        else {
            return false;
        };
        object_expression = next_object_expression;
    }
    get_static_object_property_value(object_expression, final_property_name).is_none()
}

fn three_instanced_mesh_local_object_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::ObjectExpression(_)) {
        return Some(expression);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
        .filter(|initializer| matches!(initializer, Expression::ObjectExpression(_)))
}

fn three_instanced_mesh_function_returns_node_on_every_path<'a>(
    function_id: NodeId,
    target_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = three_instanced_mesh_return_expression_contains_node(
            expression,
            target_id,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        );
        visited_function_ids.pop();
        return matches;
    }
    let statements = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .body
            .as_ref()
            .map(|body| body.statements.as_slice()),
        AstKind::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .map(|body| body.statements.as_slice()),
        _ => None,
    };
    let Some(statements) = statements else {
        visited_function_ids.pop();
        return false;
    };
    let mut return_arguments = Vec::new();
    let mut has_bare_return = false;
    for &candidate_id in node_index.node_ids(function_id) {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(candidate_id).kind() else {
            continue;
        };
        if let Some(argument) = statement.argument.as_ref() {
            return_arguments.push(argument);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && statements.iter().any(statement_always_exits)
        && !return_arguments.is_empty()
        && return_arguments.into_iter().all(|argument| {
            three_instanced_mesh_return_expression_contains_node(
                argument,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut Vec::new(),
            )
        });
    visited_function_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn three_instanced_mesh_return_expression_contains_node<'a>(
    expression: &'a Expression<'a>,
    target_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if expression.node_id() == target_id {
        return true;
    }
    match expression {
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
            let assigned_expressions = r3f_analyzed_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            let matches = !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    let assigned_expression = assigned_expression.get_inner_expression();
                    if matches!(
                        assigned_expression,
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) {
                        return false;
                    }
                    three_instanced_mesh_return_expression_contains_node(
                        assigned_expression,
                        target_id,
                        node_index,
                        ctx,
                        resolution_cache,
                        assigned_expression_cache,
                        visited_function_ids,
                        &mut visited_symbol_ids.clone(),
                    )
                });
            visited_symbol_ids.pop();
            matches
        }
        Expression::CallExpression(call_expression) if call_expression.arguments.is_empty() => {
            matches!(&call_expression.callee, Expression::Identifier(_))
                && r3f_analyzed_zero_argument_helper_id(&call_expression.callee, ctx).is_some_and(
                    |called_function_id| {
                        three_instanced_mesh_function_returns_node_on_every_path(
                            called_function_id,
                            target_id,
                            node_index,
                            ctx,
                            resolution_cache,
                            assigned_expression_cache,
                            visited_function_ids,
                        )
                    },
                )
        }
        Expression::ConditionalExpression(conditional) => {
            three_instanced_mesh_return_expression_contains_node(
                &conditional.consequent,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && three_instanced_mesh_return_expression_contains_node(
                &conditional.alternate,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical) => {
            three_instanced_mesh_return_expression_contains_node(
                &logical.left,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && three_instanced_mesh_return_expression_contains_node(
                &logical.right,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        _ => false,
    }
}

fn three_instanced_mesh_node_is_within(
    node: &AstNode<'_>,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    node.id() == boundary_id
        || ctx
            .nodes()
            .ancestors(node.id())
            .any(|ancestor| ancestor.id() == boundary_id)
}

fn three_instanced_mesh_node_is_within_span(node: &AstNode<'_>, boundary_span: Span) -> bool {
    node.span().start >= boundary_span.start && node.span().end <= boundary_span.end
}
