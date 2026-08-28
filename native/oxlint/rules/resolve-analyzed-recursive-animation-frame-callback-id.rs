fn resolve_analyzed_recursive_animation_frame_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    should_require_unconditional_schedule: bool,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if !is_global_request_animation_frame_call(call_expression, ctx) {
        return None;
    }
    let callback_id = exact_local_function_id_including_generators(
        call_expression.arguments.first()?.as_expression()?,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )?;
    node_index
        .node_ids(callback_id)
        .iter()
        .copied()
        .any(|candidate_id| {
            let candidate = ctx.nodes().get_node(candidate_id);
            let oxc_ast::AstKind::CallExpression(recursive_call) = candidate.kind() else {
                return false;
            };
            if !is_global_request_animation_frame_call(recursive_call, ctx)
                || (should_require_unconditional_schedule
                    && !is_on_unconditional_animation_frame_path(candidate, callback_id, ctx))
            {
                return false;
            }
            recursive_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .and_then(|argument| {
                    exact_local_function_id_including_generators(
                        argument,
                        ctx,
                        &mut Vec::new(),
                        resolution_cache,
                    )
                })
                == Some(callback_id)
        })
        .then_some(callback_id)
}
