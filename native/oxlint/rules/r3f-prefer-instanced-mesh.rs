use oxc_ast::{
    AstKind,
    ast::{ArrayExpressionElement, Expression, JSXChild, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::Span;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This map renders multiple meshes with the same geometry and material, creating a draw call for each item. Use <instancedMesh> and set each instance transform";

#[derive(Debug, Default, Clone)]
pub struct R3FPreferInstancedMesh;

impl RuleMeta for R3FPreferInstancedMesh {
    const NAME: &'static str = "r3f-prefer-instanced-mesh";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer instanced meshes for repeated R3F meshes.",
    };
}

impl Rule for R3FPreferInstancedMesh {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                let JSXElementName::Identifier(element_name) = &opening_element.name else {
                    return None;
                };
                (element_name.name == "mesh"
                    && is_r3f_host_intrinsic(opening_element, ctx)
                    && !r3f_instanced_mesh_has_per_instance_semantics(opening_element, ctx))
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
        let mut has_rendered_repeated_map_by_callback_id = rustc_hash::FxHashMap::default();

        for candidate_id in candidate_ids {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
                continue;
            };
            let Some(callback) = crate::ast_util::get_enclosing_function(candidate, ctx) else {
                continue;
            };
            let callback_id = callback.id();
            if r3f_instanced_mesh_has_non_rendering_ancestor(candidate, callback_id, ctx)
                || is_node_conditionally_executed(candidate, callback_id, ctx)
                || !r3f_instanced_mesh_function_returns_node_on_every_path(
                    callback_id,
                    candidate_id,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut assigned_expression_cache,
                    &mut Vec::new(),
                )
                || !r3f_instanced_mesh_has_shared_resources(
                    opening_element,
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                )
            {
                continue;
            }
            let has_rendered_repeated_map = if let Some(&cached_result) =
                has_rendered_repeated_map_by_callback_id.get(&callback_id)
            {
                cached_result
            } else {
                let result = r3f_instanced_mesh_has_rendered_repeated_map(
                    callback_id,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut assigned_expression_cache,
                );
                has_rendered_repeated_map_by_callback_id.insert(callback_id, result);
                result
            };
            if !has_rendered_repeated_map {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
        }
    }
}

fn r3f_instanced_mesh_has_shared_resources<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    ["geometry", "material"].into_iter().all(|attribute_name| {
        get_authoritative_jsx_attribute(opening_element, attribute_name, true)
            .and_then(jsx_attribute_expression)
            .is_some_and(|expression| {
                r3f_instanced_mesh_reference_is_stable(
                    expression,
                    callback_id,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                )
            })
    })
}

fn r3f_instanced_mesh_has_per_instance_semantics(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    r3f_instanced_mesh_has_non_rendering_props(opening_element)
        || matches!(
            ctx.nodes()
                .parent_node(opening_element.node_id.get())
                .kind(),
            AstKind::JSXElement(element)
                if element.children.iter().any(r3f_instanced_mesh_is_meaningful_child)
        )
}

fn r3f_instanced_mesh_has_non_rendering_props(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
        )
    }) || get_authoritative_jsx_attribute(opening_element, "attach", true).is_some()
        || get_authoritative_jsx_attribute(opening_element, "visible", true)
            .and_then(jsx_attribute_expression)
            .is_some_and(|expression| {
                matches!(
                    expression.get_inner_expression(),
                    Expression::BooleanLiteral(literal) if !literal.value
                )
            })
}

fn r3f_instanced_mesh_is_meaningful_child(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty() || !text.value.contains('\n'),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => false,
            expression => expression
                .as_expression()
                .is_some_and(|expression| !is_nullish_expression(expression)),
        },
        _ => true,
    }
}

fn r3f_instanced_mesh_has_non_rendering_ancestor(
    node: &AstNode<'_>,
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|ancestor| ancestor.id() != callback_id)
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(element)
                    if element.opening_element.node_id.get() != node.id()
                        && r3f_instanced_mesh_has_non_rendering_props(&element.opening_element)
            )
        })
}

fn r3f_instanced_mesh_reference_is_stable<'a>(
    expression: &'a Expression<'a>,
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
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
        && r3f_instanced_mesh_has_unstable_local_member_source(expression, ctx)
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
    for candidate in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if !r3f_instanced_mesh_node_is_within_span(candidate, expression.span()) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if r3f_instanced_mesh_node_is_within(ctx.symbol_declaration(symbol_id), callback_id, ctx)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    reference.is_write()
                        && r3f_instanced_mesh_node_is_within(
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

fn r3f_instanced_mesh_has_unstable_local_member_source<'a>(
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
    let Some(mut object_expression) = r3f_instanced_mesh_local_object_expression(current, ctx)
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
            r3f_instanced_mesh_local_object_expression(property_value, ctx)
        else {
            return false;
        };
        object_expression = next_object_expression;
    }
    get_static_object_property_value(object_expression, final_property_name).is_none()
}

fn r3f_instanced_mesh_local_object_expression<'a>(
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

fn r3f_instanced_mesh_has_rendered_repeated_map<'a>(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if !r3f_instanced_mesh_is_repeated_map(call_expression)
            || call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .and_then(|callback_expression| {
                    exact_local_function_id(
                        callback_expression,
                        ctx,
                        &mut Vec::new(),
                        resolution_cache,
                    )
                })
                != Some(callback_id)
        {
            continue;
        }
        let Some(render_owner) = find_render_phase_component_or_hook(candidate, ctx) else {
            continue;
        };
        let reference_ids = r3f_instanced_mesh_local_value_reference_ids(candidate, ctx);
        if r3f_instanced_mesh_function_returns_rendered_reference(
            render_owner.id(),
            &reference_ids,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            &mut Vec::new(),
        ) {
            return true;
        }
    }
    false
}

fn r3f_instanced_mesh_is_repeated_map(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Expression::StaticMemberExpression(member_expression) = &call_expression.callee else {
        return false;
    };
    if member_expression.property.name != "map" {
        return false;
    }
    let Expression::ArrayExpression(array_expression) =
        member_expression.object.get_inner_expression()
    else {
        return false;
    };
    array_expression.elements.len() >= 2
        && array_expression.elements.iter().all(|element| {
            !matches!(
                element,
                ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_)
            )
        })
}

fn r3f_instanced_mesh_local_value_reference_ids(
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
        if !matches!(
            ctx.nodes().parent_node(declarator_node.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
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

fn r3f_instanced_mesh_function_returns_rendered_reference<'a>(
    function_id: NodeId,
    reference_ids: &rustc_hash::FxHashSet<NodeId>,
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
    let matches = if let AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        r3f_instanced_mesh_return_expression_has_rendered_reference(
            expression,
            reference_ids,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
            visited_function_ids,
            &mut Vec::new(),
        )
    } else {
        node_index
            .node_ids(function_id)
            .iter()
            .any(|&candidate_id| {
                matches!(
                    ctx.nodes().get_node(candidate_id).kind(),
                    AstKind::ReturnStatement(statement)
                        if statement.argument.as_ref().is_some_and(|argument| {
                            r3f_instanced_mesh_return_expression_has_rendered_reference(
                                argument,
                                reference_ids,
                                node_index,
                                ctx,
                                resolution_cache,
                                assigned_expression_cache,
                                visited_function_ids,
                                &mut Vec::new(),
                            )
                        })
                )
            })
    };
    visited_function_ids.pop();
    matches
}

#[allow(clippy::too_many_arguments)]
fn r3f_instanced_mesh_return_expression_has_rendered_reference<'a>(
    expression: &'a Expression<'a>,
    reference_ids: &rustc_hash::FxHashSet<NodeId>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_function_ids: &mut Vec<NodeId>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if reference_ids.iter().any(|&reference_id| {
        let reference_node = ctx.nodes().get_node(reference_id);
        r3f_instanced_mesh_node_is_within_span(reference_node, expression.span())
            && !ctx
                .nodes()
                .ancestors(reference_id)
                .take_while(|ancestor| ancestor.id() != expression.node_id())
                .any(|ancestor| matches!(ancestor.kind(), AstKind::JSXAttribute(_)))
    }) {
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
            let matches = assigned_expressions.into_iter().any(|assigned_expression| {
                let assigned_expression = assigned_expression.get_inner_expression();
                if matches!(
                    assigned_expression,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) {
                    return false;
                }
                r3f_instanced_mesh_return_expression_has_rendered_reference(
                    assigned_expression,
                    reference_ids,
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
                        r3f_instanced_mesh_function_returns_rendered_reference(
                            called_function_id,
                            reference_ids,
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
            r3f_instanced_mesh_return_expression_has_rendered_reference(
                &conditional.consequent,
                reference_ids,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) || r3f_instanced_mesh_return_expression_has_rendered_reference(
                &conditional.alternate,
                reference_ids,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            )
        }
        Expression::LogicalExpression(logical) => {
            r3f_instanced_mesh_return_expression_has_rendered_reference(
                &logical.left,
                reference_ids,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) || r3f_instanced_mesh_return_expression_has_rendered_reference(
                &logical.right,
                reference_ids,
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

fn r3f_instanced_mesh_function_returns_node_on_every_path<'a>(
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
        let matches = r3f_instanced_mesh_return_expression_contains_node(
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
            r3f_instanced_mesh_return_expression_contains_node(
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
fn r3f_instanced_mesh_return_expression_contains_node<'a>(
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
    if r3f_instanced_mesh_node_is_within(ctx.nodes().get_node(target_id), expression.node_id(), ctx)
    {
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
                    r3f_instanced_mesh_return_expression_contains_node(
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
                        r3f_instanced_mesh_function_returns_node_on_every_path(
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
            r3f_instanced_mesh_return_expression_contains_node(
                &conditional.consequent,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && r3f_instanced_mesh_return_expression_contains_node(
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
            r3f_instanced_mesh_return_expression_contains_node(
                &logical.left,
                target_id,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
                visited_function_ids,
                &mut visited_symbol_ids.clone(),
            ) && r3f_instanced_mesh_return_expression_contains_node(
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

fn r3f_instanced_mesh_node_is_within(
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

fn r3f_instanced_mesh_node_is_within_span(node: &AstNode<'_>, boundary_span: Span) -> bool {
    node.span().start >= boundary_span.start && node.span().end <= boundary_span.end
}
