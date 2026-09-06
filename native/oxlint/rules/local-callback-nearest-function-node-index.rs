struct LocalCallbackNearestFunctionNodeIndex {
    node_ids_by_function_id: rustc_hash::FxHashMap<oxc_semantic::NodeId, Vec<oxc_semantic::NodeId>>,
}

fn build_local_callback_nearest_function_node_index(
    ctx: &crate::context::LintContext<'_>,
) -> LocalCallbackNearestFunctionNodeIndex {
    let mut node_ids_by_function_id = rustc_hash::FxHashMap::default();
    for node in ctx.nodes().iter() {
        let Some(function_id) = local_callback_nearest_function_id(node.id(), ctx) else {
            continue;
        };
        node_ids_by_function_id
            .entry(function_id)
            .or_insert_with(Vec::new)
            .push(node.id());
    }
    LocalCallbackNearestFunctionNodeIndex {
        node_ids_by_function_id,
    }
}

impl LocalCallbackNearestFunctionNodeIndex {
    fn node_ids(&self, function_id: oxc_semantic::NodeId) -> &[oxc_semantic::NodeId] {
        self.node_ids_by_function_id
            .get(&function_id)
            .map_or(&[], Vec::as_slice)
    }
}
