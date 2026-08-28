fn animation_callback_updates_mixer<'a>(
    callback_function_id: oxc_semantic::NodeId,
    mixer_key: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(
        ctx.nodes().get_node(callback_function_id).kind(),
        oxc_ast::AstKind::Function(function) if function.generator
    ) {
        return false;
    }
    let mut does_update_mixer = false;
    for_each_analyzed_synchronous_execution_node(
        callback_function_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| {
            if does_update_mixer {
                return;
            }
            let oxc_ast::AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            if let Some(member_expression) =
                strip_parenthesized_expression(&call_expression.callee).as_member_expression()
                && member_expression.static_property_name() == Some("update")
                && resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
                    .as_deref()
                    == Some(mixer_key)
            {
                does_update_mixer = true;
                return;
            }
            if !is_imported_or_stable_parameter_call(
                call_expression,
                ctx,
                execution_resolution_cache,
            ) {
                return;
            }
            does_update_mixer = call_expression.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|expression| {
                    resolve_expression_key(expression, ctx, &mut Vec::new()).as_deref()
                        == Some(mixer_key)
                })
            });
        },
    );
    does_update_mixer
}
