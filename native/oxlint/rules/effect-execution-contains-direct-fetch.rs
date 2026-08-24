fn effect_execution_contains_direct_fetch(
    callback: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::{
        AstKind,
        ast::{AssignmentTarget, Expression, FunctionType},
    };
    use rustc_hash::{FxHashMap, FxHashSet};

    let callback_node_id = callback.node_id();
    let mut pending_execution_root_ids = vec![callback_node_id];
    let mut visited_execution_root_ids = FxHashSet::default();
    let mut local_function_ids_by_name = FxHashMap::default();
    let mut called_binding_names = FxHashSet::default();
    let mut reassigned_binding_names = FxHashSet::default();

    while let Some(execution_root_id) = pending_execution_root_ids.pop() {
        if !visited_execution_root_ids.insert(execution_root_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if !is_inside_execution_root(candidate.id(), execution_root_id, ctx) {
                continue;
            }
            match candidate.kind() {
                AstKind::Function(function)
                    if candidate.id() != execution_root_id
                        && function.r#type == FunctionType::FunctionDeclaration =>
                {
                    if let Some(identifier) = &function.id {
                        local_function_ids_by_name
                            .insert(identifier.name.to_string(), candidate.id());
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(identifier) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(function_node_id) = declarator
                        .init
                        .as_ref()
                        .and_then(function_expression_node_id)
                    else {
                        continue;
                    };
                    local_function_ids_by_name
                        .insert(identifier.name.to_string(), function_node_id);
                }
                AstKind::AssignmentExpression(assignment) => {
                    if let AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                        &assignment.left
                    {
                        reassigned_binding_names.insert(identifier.name.to_string());
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let callee = call_expression.callee.get_inner_expression();
                    if matches!(callee, Expression::Identifier(identifier) if identifier.name == "fetch")
                    {
                        return true;
                    }
                    if let Some(function_node_id) = function_expression_node_id(callee) {
                        pending_execution_root_ids.push(function_node_id);
                        continue;
                    }
                    if let Expression::Identifier(identifier) = callee {
                        called_binding_names.insert(identifier.name.to_string());
                        continue;
                    }
                    let Some(member_expression) = callee.as_member_expression() else {
                        continue;
                    };
                    if !matches!(
                        member_expression_identifier_property_name(member_expression),
                        Some("then" | "catch" | "finally")
                    ) || !matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::CallExpression(_)
                    ) {
                        continue;
                    }
                    for argument in &call_expression.arguments {
                        let Some(function_node_id) = argument
                            .as_expression()
                            .and_then(function_expression_node_id)
                        else {
                            continue;
                        };
                        pending_execution_root_ids.push(function_node_id);
                    }
                }
                _ => {}
            }
        }

        for called_binding_name in &called_binding_names {
            if reassigned_binding_names.contains(called_binding_name) {
                continue;
            }
            if let Some(function_node_id) = local_function_ids_by_name.get(called_binding_name) {
                pending_execution_root_ids.push(*function_node_id);
            }
        }
    }

    false
}

fn is_inside_execution_root(
    candidate_node_id: oxc_semantic::NodeId,
    execution_root_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    if candidate_node_id == execution_root_id {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(candidate_node_id) {
        if ancestor.id() == execution_root_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_)
                | oxc_ast::AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn function_expression_node_id(
    expression: &oxc_ast::ast::Expression<'_>,
) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::FunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
            Some(function.node_id.get())
        }
        _ => None,
    }
}
