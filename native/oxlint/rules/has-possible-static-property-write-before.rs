struct PossibleStaticPropertyWriteAnalysis {
    calls_by_function: rustc_hash::FxHashMap<oxc_semantic::NodeId, Vec<oxc_semantic::NodeId>>,
    first_await_by_function: rustc_hash::FxHashMap<oxc_semantic::NodeId, u32>,
}

const EXACT_LOCAL_FUNCTION_MAX_DEPTH: usize = 15;

#[derive(Default)]
struct LocalFunctionResolutionCache {
    symbol_has_write: rustc_hash::FxHashMap<oxc_semantic::SymbolId, bool>,
    possible_function_ids_by_symbol:
        rustc_hash::FxHashMap<oxc_semantic::SymbolId, Vec<oxc_semantic::NodeId>>,
    const_equivalent_symbol_ids:
        rustc_hash::FxHashMap<oxc_semantic::SymbolId, std::rc::Rc<[oxc_semantic::SymbolId]>>,
}

fn build_possible_static_property_write_analysis(
    ctx: &crate::context::LintContext<'_>,
) -> PossibleStaticPropertyWriteAnalysis {
    let mut calls_by_function = rustc_hash::FxHashMap::default();
    let mut first_await_by_function: rustc_hash::FxHashMap<oxc_semantic::NodeId, u32> =
        rustc_hash::FxHashMap::default();
    let mut resolution_cache = LocalFunctionResolutionCache::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            oxc_ast::AstKind::CallExpression(call_expression) => {
                let callee_symbol_id = match call_expression.callee.get_inner_expression() {
                    oxc_ast::ast::Expression::Identifier(identifier) => ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id(),
                    _ => None,
                };
                if let Some(callee_symbol_id) = callee_symbol_id {
                    if !resolution_cache
                        .possible_function_ids_by_symbol
                        .contains_key(&callee_symbol_id)
                    {
                        let function_ids = possible_local_function_ids(
                            &call_expression.callee,
                            ctx,
                            &mut Vec::new(),
                            &mut resolution_cache,
                        );
                        resolution_cache
                            .possible_function_ids_by_symbol
                            .insert(callee_symbol_id, function_ids);
                    }
                    for function_id in resolution_cache
                        .possible_function_ids_by_symbol
                        .get(&callee_symbol_id)
                        .into_iter()
                        .flatten()
                    {
                        calls_by_function
                            .entry(*function_id)
                            .or_insert_with(Vec::new)
                            .push(node.id());
                    }
                } else {
                    for function_id in possible_local_function_ids(
                        &call_expression.callee,
                        ctx,
                        &mut Vec::new(),
                        &mut resolution_cache,
                    ) {
                        calls_by_function
                            .entry(function_id)
                            .or_insert_with(Vec::new)
                            .push(node.id());
                    }
                }
            }
            oxc_ast::AstKind::AwaitExpression(_) => {
                if let Some(function) = crate::ast_util::get_enclosing_function(node, ctx) {
                    first_await_by_function
                        .entry(function.id())
                        .and_modify(|offset| *offset = (*offset).min(node.span().start))
                        .or_insert(node.span().start);
                }
            }
            _ => {}
        }
    }
    PossibleStaticPropertyWriteAnalysis {
        calls_by_function,
        first_await_by_function,
    }
}

fn has_possible_static_property_write_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    reference_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    has_possible_static_property_write_for_symbol_before(
        root_symbol_id,
        property_name,
        reference_node,
        analysis,
        ctx,
    )
}

fn has_possible_static_property_write_for_symbol_before<'a>(
    root_symbol_id: oxc_semantic::SymbolId,
    property_name: &str,
    reference_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let Some(member_node) = static_property_write_member(identifier_node, ctx) else {
                return false;
            };
            if !can_node_execute_before(member_node, reference_node, analysis, ctx) {
                return false;
            }
            resolved_static_member_property_name(member_node, ctx)
                .is_none_or(|written_property_name| written_property_name == property_name)
        })
}

fn potential_alias_symbol_ids(
    root_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> Vec<oxc_semantic::SymbolId> {
    let mut symbol_ids = vec![root_symbol_id];
    let mut seen_symbol_ids = rustc_hash::FxHashSet::from_iter([root_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            if let Some(alias_symbol_id) =
                direct_alias_target_symbol_id(ctx.nodes().get_node(reference.node_id()), ctx)
                && seen_symbol_ids.insert(alias_symbol_id)
            {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    symbol_ids
}

fn direct_alias_target_symbol_id<'a>(
    source_identifier: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let source_root = transparent_expression_root(source_identifier, ctx);
    let parent = ctx.nodes().parent_node(source_root.id());
    match parent.kind() {
        oxc_ast::AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == source_root.span()) =>
        {
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        oxc_ast::AstKind::AssignmentExpression(assignment)
            if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                && assignment.right.span() == source_root.span() =>
        {
            match &assignment.left {
                oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                    Some(identifier.reference_id())
                }
                _ => None,
            }
            .and_then(|reference_id| ctx.scoping().get_reference(reference_id).symbol_id())
        }
        _ => None,
    }
}

fn static_property_write_member<'a, 'b>(
    identifier_node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let member_node = receiver_member_node(identifier_node, ctx)?;
    member_node_is_write(member_node, ctx).then_some(member_node)
}

fn resolved_static_member_property_name<'a>(
    member_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    match member_node.kind() {
        oxc_ast::AstKind::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        oxc_ast::AstKind::ComputedMemberExpression(member) => {
            if let Some(property_name) = member.static_property_name() {
                return Some(property_name.to_string());
            }
            let oxc_ast::ast::Expression::Identifier(identifier) =
                member.expression.get_inner_expression()
            else {
                return None;
            };
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            let oxc_ast::ast::Expression::StringLiteral(literal) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            Some(literal.value.to_string())
        }
        _ => None,
    }
}

fn can_node_execute_before<'a>(
    candidate: &crate::AstNode<'a>,
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let candidate_boundary = execution_boundary(candidate, ctx);
    let reference_boundary = execution_boundary(reference, ctx);
    if candidate_boundary.id() == reference_boundary.id() {
        let reference_offset = if matches!(reference.kind(), oxc_ast::AstKind::Program(_)) {
            reference.span().end
        } else {
            reference.span().start
        };
        return candidate.span().start < reference_offset;
    }
    if !matches!(
        candidate_boundary.kind(),
        oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
    ) {
        return true;
    }
    function_is_synchronously_invoked_before(candidate_boundary.id(), reference, analysis, ctx)
}

fn execution_boundary<'a, 'b>(
    node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> &'b crate::AstNode<'a> {
    crate::ast_util::get_enclosing_function(node, ctx)
        .unwrap_or_else(|| ctx.nodes().iter().next().expect("program node"))
}

fn function_is_synchronously_invoked_before<'a>(
    function_id: oxc_semantic::NodeId,
    reference: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let reference_boundary_id = execution_boundary(reference, ctx).id();
    let mut visited_function_states = rustc_hash::FxHashSet::default();
    let mut pending_functions = vec![(function_id, None)];
    while let Some((pending_function_id, synchronous_node_id)) = pending_functions.pop() {
        let function_node = ctx.nodes().get_node(pending_function_id);
        if matches!(function_node.kind(), oxc_ast::AstKind::Function(function) if function.generator)
        {
            continue;
        }
        if let Some(synchronous_node_id) = synchronous_node_id {
            let synchronous_node = ctx.nodes().get_node(synchronous_node_id);
            if !node_is_on_unconditional_path(synchronous_node, function_node, ctx)
                || (function_is_async(function_node)
                    && analysis
                        .first_await_by_function
                        .get(&pending_function_id)
                        .is_some_and(|offset| synchronous_node.span().start >= *offset))
            {
                continue;
            }
        }
        if !visited_function_states.insert((pending_function_id, synchronous_node_id.is_some())) {
            continue;
        }
        for call_id in analysis
            .calls_by_function
            .get(&pending_function_id)
            .into_iter()
            .flatten()
        {
            let call_node = ctx.nodes().get_node(*call_id);
            let call_boundary = execution_boundary(call_node, ctx);
            if call_boundary.id() == reference_boundary_id {
                if call_node.span().start < reference.span().start {
                    return true;
                }
                continue;
            }
            if matches!(
                call_boundary.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            ) {
                pending_functions.push((call_boundary.id(), synchronous_node_id.map(|_| *call_id)));
            }
        }
    }
    false
}

fn function_is_async(function_node: &crate::AstNode<'_>) -> bool {
    match function_node.kind() {
        oxc_ast::AstKind::Function(function) => function.r#async,
        oxc_ast::AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn node_is_on_unconditional_path(
    node: &crate::AstNode<'_>,
    boundary: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == boundary.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            oxc_ast::AstKind::CatchClause(_)
                | oxc_ast::AstKind::ConditionalExpression(_)
                | oxc_ast::AstKind::DoWhileStatement(_)
                | oxc_ast::AstKind::ForInStatement(_)
                | oxc_ast::AstKind::ForOfStatement(_)
                | oxc_ast::AstKind::ForStatement(_)
                | oxc_ast::AstKind::IfStatement(_)
                | oxc_ast::AstKind::LogicalExpression(_)
                | oxc_ast::AstKind::SwitchCase(_)
                | oxc_ast::AstKind::SwitchStatement(_)
                | oxc_ast::AstKind::TryStatement(_)
                | oxc_ast::AstKind::WhileStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn possible_local_function_ids<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression()
        && matches!(member.static_property_name(), Some("call" | "apply"))
    {
        return possible_local_function_ids(
            member.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
        );
    }
    if let oxc_ast::ast::Expression::CallExpression(call) = expression
        && let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && member.static_property_name() == Some("bind")
    {
        return possible_local_function_ids(
            member.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
        );
    }
    if let Some(member) = expression.as_member_expression() {
        return possible_member_function_ids(
            member,
            expression.node_id(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
        );
    }
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
            vec![function.node_id.get()]
        }
        oxc_ast::ast::Expression::FunctionExpression(function) if !function.generator => {
            vec![function.node_id.get()]
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return Vec::new();
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return Vec::new();
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                oxc_ast::AstKind::Function(function)
                    if !function.generator
                        && !cached_symbol_has_write(symbol_id, ctx, resolution_cache) =>
                {
                    vec![declaration.id()]
                }
                oxc_ast::AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    declarator
                        .init
                        .as_ref()
                        .map_or_else(Vec::new, |initializer| {
                            possible_local_function_ids(
                                initializer,
                                ctx,
                                visited_symbol_ids,
                                resolution_cache,
                            )
                        })
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

fn possible_member_function_ids<'a>(
    member: &oxc_ast::ast::MemberExpression<'a>,
    member_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    let Some(property_name) = member.static_property_name() else {
        return Vec::new();
    };
    let receiver = member.object().get_inner_expression();
    match receiver {
        oxc_ast::ast::Expression::ObjectExpression(object) => {
            return possible_object_property_function_ids(
                object,
                property_name,
                ctx,
                visited_symbol_ids,
                resolution_cache,
            );
        }
        oxc_ast::ast::Expression::ClassExpression(class) => {
            return possible_class_property_function_ids(
                class,
                property_name,
                ctx,
                visited_symbol_ids,
                resolution_cache,
            );
        }
        _ => {}
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = receiver else {
        return Vec::new();
    };
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return Vec::new();
    };
    if visited_symbol_ids.contains(&root_symbol_id) {
        return Vec::new();
    }
    visited_symbol_ids.push(root_symbol_id);
    let declaration = ctx.symbol_declaration(root_symbol_id);
    let mut possible_function_ids = match declaration.kind() {
        oxc_ast::AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) =>
        {
            declarator
                .init
                .as_ref()
                .map_or_else(Vec::new, |initializer| {
                    match initializer.get_inner_expression() {
                        oxc_ast::ast::Expression::ObjectExpression(object) => {
                            possible_object_property_function_ids(
                                object,
                                property_name,
                                ctx,
                                &mut visited_symbol_ids.clone(),
                                resolution_cache,
                            )
                        }
                        oxc_ast::ast::Expression::ClassExpression(class) => {
                            possible_class_property_function_ids(
                                class,
                                property_name,
                                ctx,
                                &mut visited_symbol_ids.clone(),
                                resolution_cache,
                            )
                        }
                        _ => Vec::new(),
                    }
                })
        }
        oxc_ast::AstKind::Class(class) => possible_class_property_function_ids(
            class,
            property_name,
            ctx,
            &mut visited_symbol_ids.clone(),
            resolution_cache,
        ),
        _ => Vec::new(),
    };
    let member_node = ctx.nodes().get_node(member_node_id);
    let call_boundary_id = execution_boundary(member_node, ctx).id();
    let mut mutations = cached_const_equivalent_symbol_ids(root_symbol_id, ctx, resolution_cache)
        .iter()
        .copied()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .filter_map(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            if identifier_node.span().start >= member_node.span().start {
                return None;
            }
            let written_member = static_property_write_member(identifier_node, ctx)?;
            if execution_boundary(written_member, ctx).id() != call_boundary_id {
                return None;
            }
            let written_property_name = resolved_static_member_property_name(written_member, ctx);
            if written_property_name
                .as_deref()
                .is_some_and(|name| name != property_name)
            {
                return None;
            }
            let member_root = transparent_expression_root(written_member, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            let assigned_expression = match parent.kind() {
                oxc_ast::AstKind::AssignmentExpression(assignment)
                    if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign =>
                {
                    Some(&assignment.right)
                }
                _ => None,
            };
            let assigned_function_id = assigned_expression.and_then(|expression| {
                exact_local_function_id(
                    expression,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                    resolution_cache,
                )
            });
            let is_definite = written_property_name.as_deref() == Some(property_name)
                && assigned_expression.is_some()
                && node_is_on_unconditional_path(
                    written_member,
                    execution_boundary(member_node, ctx),
                    ctx,
                );
            Some((
                written_member.span().start,
                is_definite,
                assigned_function_id,
            ))
        })
        .collect::<Vec<_>>();
    mutations.sort_by_key(|(offset, _, _)| *offset);
    for (_, is_definite, assigned_function_id) in mutations {
        if is_definite {
            possible_function_ids.clear();
        }
        if let Some(assigned_function_id) = assigned_function_id
            && !possible_function_ids.contains(&assigned_function_id)
        {
            possible_function_ids.push(assigned_function_id);
        }
    }
    possible_function_ids
}

fn possible_object_property_function_ids<'a>(
    object: &oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    let mut possible_function_ids = Vec::new();
    for property in &object.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let candidate_name = resolved_property_key_name(&property.key, property.computed, ctx);
        let candidate_function_id = matches!(
            property.kind,
            oxc_ast::ast::PropertyKind::Init | oxc_ast::ast::PropertyKind::Get
        )
        .then(|| {
            exact_local_function_id(
                &property.value,
                ctx,
                &mut visited_symbol_ids.clone(),
                resolution_cache,
            )
        })
        .flatten();
        if candidate_name.as_deref() == Some(property_name) {
            possible_function_ids.clear();
            if let Some(candidate_function_id) = candidate_function_id {
                possible_function_ids.push(candidate_function_id);
            }
        } else if candidate_name.is_none()
            && let Some(candidate_function_id) = candidate_function_id
            && !possible_function_ids.contains(&candidate_function_id)
        {
            possible_function_ids.push(candidate_function_id);
        }
    }
    possible_function_ids
}

fn possible_class_property_function_ids<'a>(
    class: &oxc_ast::ast::Class<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<oxc_semantic::NodeId> {
    let mut possible_function_ids = Vec::new();
    for element in &class.body.body {
        let (candidate_name, candidate_function_id) = match element {
            oxc_ast::ast::ClassElement::MethodDefinition(method) if method.r#static => (
                resolved_property_key_name(&method.key, method.computed, ctx),
                matches!(
                    method.kind,
                    oxc_ast::ast::MethodDefinitionKind::Method
                        | oxc_ast::ast::MethodDefinitionKind::Get
                )
                .then_some(method.value.node_id.get()),
            ),
            oxc_ast::ast::ClassElement::PropertyDefinition(property) if property.r#static => (
                resolved_property_key_name(&property.key, property.computed, ctx),
                property.value.as_ref().and_then(|value| {
                    exact_local_function_id(
                        value,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                        resolution_cache,
                    )
                }),
            ),
            _ => continue,
        };
        if candidate_name.as_deref() == Some(property_name) {
            possible_function_ids.clear();
            if let Some(candidate_function_id) = candidate_function_id {
                possible_function_ids.push(candidate_function_id);
            }
        } else if candidate_name.is_none()
            && let Some(candidate_function_id) = candidate_function_id
            && !possible_function_ids.contains(&candidate_function_id)
        {
            possible_function_ids.push(candidate_function_id);
        }
    }
    possible_function_ids
}

fn exact_local_function_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    exact_local_function_id_with_generator_mode(
        expression,
        ctx,
        visited_symbol_ids,
        resolution_cache,
        false,
    )
}

fn exact_local_function_id_including_generators<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    exact_local_function_id_with_generator_mode(
        expression,
        ctx,
        visited_symbol_ids,
        resolution_cache,
        true,
    )
}

fn exact_local_function_id_with_generator_mode<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    include_generators: bool,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        oxc_ast::ast::Expression::ArrowFunctionExpression(_)
    ) || matches!(expression, oxc_ast::ast::Expression::FunctionExpression(function)
            if include_generators || !function.generator)
    {
        return Some(expression.node_id());
    }
    if visited_symbol_ids.len() >= EXACT_LOCAL_FUNCTION_MAX_DEPTH {
        return None;
    }
    if let Some(member) = expression.as_member_expression()
        && matches!(member.static_property_name(), Some("call" | "apply"))
    {
        return exact_local_function_id_with_generator_mode(
            member.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
            include_generators,
        );
    }
    if let oxc_ast::ast::Expression::CallExpression(call) = expression
        && let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && member.static_property_name() == Some("bind")
    {
        return exact_local_function_id_with_generator_mode(
            member.object(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
            include_generators,
        );
    }
    if let Some(member) = expression.as_member_expression() {
        return exact_member_function_id(
            member,
            expression.node_id(),
            ctx,
            visited_symbol_ids,
            resolution_cache,
            include_generators,
        );
    }
    match expression {
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        oxc_ast::ast::Expression::FunctionExpression(function)
            if include_generators || !function.generator =>
        {
            Some(function.node_id.get())
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                oxc_ast::AstKind::Function(function)
                    if (include_generators || !function.generator)
                        && !cached_symbol_has_write(symbol_id, ctx, resolution_cache) =>
                {
                    Some(declaration.id())
                }
                oxc_ast::AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    exact_local_function_id_with_generator_mode(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                        resolution_cache,
                        include_generators,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn exact_member_function_id<'a>(
    member: &oxc_ast::ast::MemberExpression<'a>,
    member_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    include_generators: bool,
) -> Option<oxc_semantic::NodeId> {
    let property_name = member.static_property_name()?;
    let receiver = member.object().get_inner_expression();
    match receiver {
        oxc_ast::ast::Expression::ObjectExpression(object) => {
            return exact_object_property_function_id(
                object,
                property_name,
                ctx,
                visited_symbol_ids,
                resolution_cache,
                include_generators,
            );
        }
        oxc_ast::ast::Expression::ClassExpression(class) => {
            return exact_class_property_function_id(
                class,
                property_name,
                ctx,
                visited_symbol_ids,
                resolution_cache,
                include_generators,
            );
        }
        _ => {}
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = receiver else {
        return None;
    };
    let root_symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    if visited_symbol_ids.contains(&root_symbol_id) {
        return None;
    }
    visited_symbol_ids.push(root_symbol_id);
    let declaration = ctx.symbol_declaration(root_symbol_id);
    let initial_function_id = match declaration.kind() {
        oxc_ast::AstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) =>
        {
            declarator.init.as_ref().and_then(|initializer| {
                match initializer.get_inner_expression() {
                    oxc_ast::ast::Expression::ObjectExpression(object) => {
                        exact_object_property_function_id(
                            object,
                            property_name,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                            resolution_cache,
                            include_generators,
                        )
                    }
                    oxc_ast::ast::Expression::ClassExpression(class) => {
                        exact_class_property_function_id(
                            class,
                            property_name,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                            resolution_cache,
                            include_generators,
                        )
                    }
                    _ => None,
                }
            })
        }
        oxc_ast::AstKind::Class(class) => exact_class_property_function_id(
            class,
            property_name,
            ctx,
            &mut visited_symbol_ids.clone(),
            resolution_cache,
            include_generators,
        ),
        _ => None,
    };
    resolve_exact_assigned_member_function(
        root_symbol_id,
        member_node_id,
        property_name,
        initial_function_id,
        ctx,
        visited_symbol_ids,
        resolution_cache,
        include_generators,
    )
}

fn exact_object_property_function_id<'a>(
    object: &oxc_ast::ast::ObjectExpression<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    include_generators: bool,
) -> Option<oxc_semantic::NodeId> {
    for property in object.properties.iter().rev() {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let candidate_name = resolved_property_key_name(&property.key, property.computed, ctx)?;
        if candidate_name != property_name {
            continue;
        }
        if property.kind != oxc_ast::ast::PropertyKind::Init {
            return None;
        }
        return exact_local_function_id_with_generator_mode(
            &property.value,
            ctx,
            visited_symbol_ids,
            resolution_cache,
            include_generators,
        );
    }
    None
}

fn exact_class_property_function_id<'a>(
    class: &oxc_ast::ast::Class<'a>,
    property_name: &str,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    include_generators: bool,
) -> Option<oxc_semantic::NodeId> {
    for element in class.body.body.iter().rev() {
        match element {
            oxc_ast::ast::ClassElement::MethodDefinition(method) if method.r#static => {
                let candidate_name = resolved_property_key_name(&method.key, method.computed, ctx)?;
                if candidate_name != property_name {
                    continue;
                }
                return (method.kind == oxc_ast::ast::MethodDefinitionKind::Method)
                    .then_some(method.value.node_id.get());
            }
            oxc_ast::ast::ClassElement::PropertyDefinition(property) if property.r#static => {
                let candidate_name =
                    resolved_property_key_name(&property.key, property.computed, ctx)?;
                if candidate_name != property_name {
                    continue;
                }
                return exact_local_function_id_with_generator_mode(
                    property.value.as_ref()?,
                    ctx,
                    visited_symbol_ids,
                    resolution_cache,
                    include_generators,
                );
            }
            _ => {}
        }
    }
    None
}

fn resolve_exact_assigned_member_function(
    root_symbol_id: oxc_semantic::SymbolId,
    member_node_id: oxc_semantic::NodeId,
    property_name: &str,
    initial_function_id: Option<oxc_semantic::NodeId>,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    include_generators: bool,
) -> Option<oxc_semantic::NodeId> {
    let member_node = ctx.nodes().get_node(member_node_id);
    let call_boundary = execution_boundary(member_node, ctx);
    let mut mutations = cached_const_equivalent_symbol_ids(root_symbol_id, ctx, resolution_cache)
        .iter()
        .copied()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .filter_map(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            if identifier_node.span().start >= member_node.span().start
                || const_alias_source_reference(identifier_node, ctx)
            {
                return None;
            }
            let Some(candidate_member) = receiver_member_node(identifier_node, ctx) else {
                return (execution_boundary(identifier_node, ctx).id() == call_boundary.id())
                    .then_some((identifier_node.span().start, false, None));
            };
            if !member_node_is_write(candidate_member, ctx)
                || execution_boundary(candidate_member, ctx).id() != call_boundary.id()
            {
                return None;
            }
            let assigned_property_name =
                resolved_static_member_property_name(candidate_member, ctx);
            if assigned_property_name
                .as_deref()
                .is_some_and(|name| name != property_name)
            {
                return None;
            }
            let member_root = transparent_expression_root(candidate_member, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            let assigned_expression = match parent.kind() {
                oxc_ast::AstKind::AssignmentExpression(assignment)
                    if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign =>
                {
                    Some(&assignment.right)
                }
                _ => None,
            };
            let assigned_function_id = assigned_expression.and_then(|expression| {
                exact_local_function_id_with_generator_mode(
                    expression,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                    resolution_cache,
                    include_generators,
                )
            });
            let is_definite = assigned_property_name.as_deref() == Some(property_name)
                && assigned_expression.is_some()
                && node_is_on_unconditional_path(candidate_member, call_boundary, ctx);
            Some((
                candidate_member.span().start,
                is_definite,
                assigned_function_id,
            ))
        })
        .collect::<Vec<_>>();
    mutations.sort_by_key(|(offset, _, _)| *offset);
    let mut exact_function_id = initial_function_id;
    for (_, is_definite, assigned_function_id) in mutations {
        exact_function_id = is_definite.then_some(assigned_function_id).flatten();
    }
    exact_function_id
}

fn cached_symbol_has_write(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if let Some(has_write) = resolution_cache.symbol_has_write.get(&symbol_id) {
        return *has_write;
    }
    let has_write = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write);
    resolution_cache
        .symbol_has_write
        .insert(symbol_id, has_write);
    has_write
}

fn cached_const_equivalent_symbol_ids(
    root_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> std::rc::Rc<[oxc_semantic::SymbolId]> {
    if let Some(symbol_ids) = resolution_cache
        .const_equivalent_symbol_ids
        .get(&root_symbol_id)
    {
        return std::rc::Rc::clone(symbol_ids);
    }
    let mut symbol_ids = vec![root_symbol_id];
    let mut seen_symbol_ids = rustc_hash::FxHashSet::from_iter([root_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let declarator_node = ctx.nodes().parent_node(reference_root.id());
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
                || !matches!(
                    ctx.nodes().parent_node(declarator_node.id()).kind(),
                    oxc_ast::AstKind::VariableDeclaration(declaration)
                        if declaration.kind.is_const()
                )
            {
                continue;
            }
            if let Some(alias_symbol_id) = declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
                && seen_symbol_ids.insert(alias_symbol_id)
            {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    let symbol_ids: std::rc::Rc<[oxc_semantic::SymbolId]> = symbol_ids.into();
    resolution_cache
        .const_equivalent_symbol_ids
        .insert(root_symbol_id, std::rc::Rc::clone(&symbol_ids));
    symbol_ids
}

fn const_alias_source_reference<'a>(
    identifier_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(identifier_node, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    matches!(
        parent.kind(),
        oxc_ast::AstKind::VariableDeclarator(declarator)
            if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == reference_root.span())
                && matches!(
                    ctx.nodes().parent_node(parent.id()).kind(),
                    oxc_ast::AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
                )
    )
}

fn receiver_member_node<'a, 'b>(
    identifier_node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b crate::AstNode<'a>> {
    let identifier_root = transparent_expression_root(identifier_node, ctx);
    let member_node = ctx.nodes().parent_node(identifier_root.id());
    let object_span = match member_node.kind() {
        oxc_ast::AstKind::StaticMemberExpression(member) => member.object.span(),
        oxc_ast::AstKind::ComputedMemberExpression(member) => member.object.span(),
        _ => return None,
    };
    (object_span == identifier_root.span()).then_some(member_node)
}

fn member_node_is_write<'a>(
    member_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let member_root = transparent_expression_root(member_node, ctx);
    let parent = ctx.nodes().parent_node(member_root.id());
    match parent.kind() {
        oxc_ast::AstKind::AssignmentExpression(assignment) => {
            assignment.left.span() == member_root.span()
        }
        oxc_ast::AstKind::UpdateExpression(update) => update.argument.span() == member_root.span(),
        oxc_ast::AstKind::UnaryExpression(unary) => {
            unary.operator == oxc_syntax::operator::UnaryOperator::Delete
                && unary.argument.span() == member_root.span()
        }
        _ => false,
    }
}

fn resolved_property_key_name<'a>(
    key: &oxc_ast::ast::PropertyKey<'a>,
    computed: bool,
    ctx: &crate::context::LintContext<'a>,
) -> Option<String> {
    if !computed {
        return key.static_name().map(|name| name.to_string());
    }
    match key {
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        oxc_ast::ast::PropertyKey::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        oxc_ast::ast::PropertyKey::Identifier(identifier) => {
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            let oxc_ast::ast::Expression::StringLiteral(literal) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            Some(literal.value.to_string())
        }
        _ => None,
    }
}
