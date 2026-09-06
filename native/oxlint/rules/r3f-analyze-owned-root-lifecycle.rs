#[derive(Clone)]
enum R3fOwnedRootAccessPath {
    Direct,
    Object(String),
    Array(usize),
}

struct R3fOwnedRootLifecycle {
    access_path: R3fOwnedRootAccessPath,
    is_stable: bool,
    owner_id: oxc_semantic::NodeId,
    owner_symbol_ids: rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    resource_symbol_ids: rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
}

fn r3f_analyze_owned_root_lifecycle<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
) -> Option<R3fOwnedRootLifecycle> {
    r3f_owned_root_lazy_ref_binding(allocation, analysis, ctx)
        .or_else(|| r3f_owned_root_factory_binding(allocation, analysis, node_index, ctx))
        .map(|mut lifecycle| {
            lifecycle.owner_symbol_ids = r3f_root_collect_alias_symbol_ids(
                *lifecycle
                    .owner_symbol_ids
                    .iter()
                    .next()
                    .expect("owner symbol"),
                ctx,
            );
            lifecycle.resource_symbol_ids = r3f_owned_root_collect_resource_aliases(
                &lifecycle.owner_symbol_ids,
                &lifecycle.access_path,
                ctx,
            );
            lifecycle
        })
}

fn r3f_owned_root_lazy_ref_binding<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> Option<R3fOwnedRootLifecycle> {
    let allocation_root = transparent_expression_root(allocation, ctx);
    let assignment_node = ctx.nodes().parent_node(allocation_root.id());
    let oxc_ast::AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
        return None;
    };
    if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
        || assignment.right.span() != allocation_root.span()
    {
        return None;
    }
    let member = assignment.left.as_member_expression()?;
    if member.static_property_name() != Some("current") {
        return None;
    }
    let oxc_ast::ast::Expression::Identifier(ref_identifier) =
        member.object().get_inner_expression()
    else {
        return None;
    };
    let ref_symbol_id = ctx
        .scoping()
        .get_reference(ref_identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != ref_symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    let oxc_ast::ast::Expression::CallExpression(use_ref_call) = initializer else {
        return None;
    };
    if !r3f_owned_root_react_api_matches(use_ref_call, "useRef", analysis, ctx)
        || !r3f_owned_root_assignment_has_empty_ref_guard(assignment_node, ref_symbol_id, ctx)
    {
        return None;
    }
    let owner_id = find_render_phase_component_or_hook(assignment_node, ctx)?.id();
    if local_callback_nearest_function_id(assignment_node.id(), ctx) != Some(owner_id) {
        return None;
    }
    Some(R3fOwnedRootLifecycle {
        access_path: R3fOwnedRootAccessPath::Object("current".to_string()),
        is_stable: true,
        owner_id,
        owner_symbol_ids: rustc_hash::FxHashSet::from_iter([ref_symbol_id]),
        resource_symbol_ids: rustc_hash::FxHashSet::default(),
    })
}

fn r3f_owned_root_assignment_has_empty_ref_guard(
    assignment: &crate::AstNode<'_>,
    ref_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(assignment.id()) {
        let oxc_ast::AstKind::IfStatement(if_statement) = ancestor.kind() else {
            if matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            ) {
                return false;
            }
            continue;
        };
        if if_statement
            .consequent
            .span()
            .contains_inclusive(assignment.span())
            && r3f_owned_root_test_proves_empty_ref(&if_statement.test, ref_symbol_id, ctx)
        {
            return true;
        }
    }
    false
}

fn r3f_owned_root_test_proves_empty_ref(
    expression: &oxc_ast::ast::Expression<'_>,
    ref_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::UnaryExpression(unary) = expression
        && unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
    {
        return r3f_owned_root_expression_matches_ref_current(&unary.argument, ref_symbol_id, ctx);
    }
    let oxc_ast::ast::Expression::BinaryExpression(binary) = expression else {
        return false;
    };
    if !matches!(
        binary.operator,
        oxc_syntax::operator::BinaryOperator::Equality
            | oxc_syntax::operator::BinaryOperator::StrictEquality
    ) {
        return false;
    }
    (r3f_owned_root_expression_matches_ref_current(&binary.left, ref_symbol_id, ctx)
        && r3f_owned_root_is_nullish(&binary.right, ctx))
        || (r3f_owned_root_is_nullish(&binary.left, ctx)
            && r3f_owned_root_expression_matches_ref_current(&binary.right, ref_symbol_id, ctx))
}

fn r3f_owned_root_expression_matches_ref_current(
    expression: &oxc_ast::ast::Expression<'_>,
    ref_symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("current") {
        return false;
    }
    matches!(member.object().get_inner_expression(), oxc_ast::ast::Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(ref_symbol_id))
}

fn r3f_owned_root_is_nullish(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::NullLiteral(_) => true,
        oxc_ast::ast::Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        _ => false,
    }
}

fn r3f_owned_root_factory_binding<'a>(
    allocation: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
) -> Option<R3fOwnedRootLifecycle> {
    let callback_id = local_callback_nearest_function_id(allocation.id(), ctx)?;
    if is_node_conditionally_executed(allocation, callback_id, ctx) {
        return None;
    }
    let callback_node = ctx.nodes().get_node(callback_id);
    let callback_root = transparent_expression_root(callback_node, ctx);
    let wrapper_node = ctx.nodes().parent_node(callback_root.id());
    let oxc_ast::AstKind::CallExpression(wrapper_call) = wrapper_node.kind() else {
        return None;
    };
    if wrapper_call
        .arguments
        .first()
        .is_none_or(|argument| argument.span() != callback_root.span())
    {
        return None;
    }
    let is_state = r3f_owned_root_react_api_matches(wrapper_call, "useState", analysis, ctx);
    let is_memo = r3f_owned_root_react_api_matches(wrapper_call, "useMemo", analysis, ctx);
    if !is_state && !is_memo {
        return None;
    }
    let access_path = r3f_owned_root_factory_return_path(callback_id, allocation, node_index, ctx)?;
    let wrapper_root = transparent_expression_root(wrapper_node, ctx);
    let declaration_node = ctx.nodes().parent_node(wrapper_root.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration_node.kind() else {
        return None;
    };
    let binding = if is_state {
        let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return None;
        };
        pattern
            .elements
            .first()?
            .as_ref()?
            .get_binding_identifier()?
    } else {
        r3f_owned_root_binding_for_path(&declarator.id, &access_path)?
    };
    let owner_id = find_render_phase_component_or_hook(wrapper_node, ctx)?.id();
    if crate::ast_util::get_enclosing_function(declaration_node, ctx).map(crate::AstNode::id)
        != Some(owner_id)
    {
        return None;
    }
    Some(R3fOwnedRootLifecycle {
        access_path: if is_state {
            access_path
        } else {
            R3fOwnedRootAccessPath::Direct
        },
        is_stable: is_state
            || wrapper_call.arguments.get(1).is_some_and(|argument| {
                matches!(argument.as_expression().map(oxc_ast::ast::Expression::get_inner_expression), Some(oxc_ast::ast::Expression::ArrayExpression(array)) if array.elements.is_empty())
            }),
        owner_id,
        owner_symbol_ids: rustc_hash::FxHashSet::from_iter([binding.symbol_id()]),
        resource_symbol_ids: rustc_hash::FxHashSet::default(),
    })
}

fn r3f_owned_root_binding_for_path<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    access_path: &R3fOwnedRootAccessPath,
) -> Option<&'a oxc_ast::ast::BindingIdentifier<'a>> {
    match access_path {
        R3fOwnedRootAccessPath::Direct => pattern.get_binding_identifier(),
        R3fOwnedRootAccessPath::Array(index) => {
            let oxc_ast::ast::BindingPattern::ArrayPattern(pattern) = pattern else {
                return None;
            };
            pattern
                .elements
                .get(*index)?
                .as_ref()?
                .get_binding_identifier()
        }
        R3fOwnedRootAccessPath::Object(property_name) => {
            let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = pattern else {
                return None;
            };
            pattern.properties.iter().find_map(|property| {
                (property.key.static_name().as_deref() == Some(property_name.as_str()))
                    .then(|| property.value.get_binding_identifier())
                    .flatten()
            })
        }
    }
}

fn r3f_owned_root_factory_return_path(
    callback_id: oxc_semantic::NodeId,
    allocation: &crate::AstNode<'_>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'_>,
) -> Option<R3fOwnedRootAccessPath> {
    let mut paths = Vec::new();
    if let oxc_ast::AstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = function.get_expression()
    {
        paths.push(r3f_owned_root_expression_allocation_path(
            expression, allocation, ctx,
        )?);
    } else {
        for &candidate_id in node_index.node_ids(callback_id) {
            let oxc_ast::AstKind::ReturnStatement(statement) =
                ctx.nodes().get_node(candidate_id).kind()
            else {
                continue;
            };
            paths.push(r3f_owned_root_expression_allocation_path(
                statement.argument.as_ref()?,
                allocation,
                ctx,
            )?);
        }
    }
    let first = paths.first()?.clone();
    paths
        .iter()
        .all(|path| r3f_owned_root_paths_equal(path, &first))
        .then_some(first)
}

fn r3f_owned_root_expression_allocation_path(
    expression: &oxc_ast::ast::Expression<'_>,
    allocation: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<R3fOwnedRootAccessPath> {
    let expression = expression.get_inner_expression();
    if expression.span() == allocation.span() {
        return Some(R3fOwnedRootAccessPath::Direct);
    }
    match expression {
        oxc_ast::ast::Expression::ArrayExpression(array) => {
            let indexes = array
                .elements
                .iter()
                .enumerate()
                .filter_map(|(index, element)| {
                    element
                        .as_expression()
                        .filter(|element| {
                            element.get_inner_expression().span() == allocation.span()
                        })
                        .map(|_| index)
                })
                .collect::<Vec<_>>();
            (indexes.len() == 1).then(|| R3fOwnedRootAccessPath::Array(indexes[0]))
        }
        oxc_ast::ast::Expression::ObjectExpression(object) => {
            let names = object
                .properties
                .iter()
                .filter_map(|property| {
                    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                    else {
                        return None;
                    };
                    (property.value.get_inner_expression().span() == allocation.span())
                        .then(|| {
                            property
                                .key
                                .static_name()
                                .as_deref()
                                .map(ToString::to_string)
                        })
                        .flatten()
                })
                .collect::<Vec<_>>();
            (names.len() == 1).then(|| R3fOwnedRootAccessPath::Object(names[0].clone()))
        }
        oxc_ast::ast::Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            (declarator.init.as_ref()?.get_inner_expression().span() == allocation.span())
                .then_some(R3fOwnedRootAccessPath::Direct)
        }
        _ => None,
    }
}

fn r3f_owned_root_paths_equal(
    left: &R3fOwnedRootAccessPath,
    right: &R3fOwnedRootAccessPath,
) -> bool {
    match (left, right) {
        (R3fOwnedRootAccessPath::Direct, R3fOwnedRootAccessPath::Direct) => true,
        (R3fOwnedRootAccessPath::Object(left), R3fOwnedRootAccessPath::Object(right)) => {
            left == right
        }
        (R3fOwnedRootAccessPath::Array(left), R3fOwnedRootAccessPath::Array(right)) => {
            left == right
        }
        _ => false,
    }
}

fn r3f_owned_root_react_api_matches<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let has_bound_namespace_receiver = call
        .callee
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member| {
            let oxc_ast::ast::Expression::Identifier(identifier) =
                member.object().get_inner_expression()
            else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        })
        .is_some();
    (has_bound_namespace_receiver && is_react_api_call(call, api_name, ctx))
        || module_api_reference_matches(
            &call.callee,
            api_name,
            &R3F_ROOT_REACT_MODULES,
            analysis,
            ctx,
        )
        || type_import_module_api_reference_matches(
            &call.callee,
            api_name,
            &R3F_ROOT_REACT_MODULES,
            analysis,
            ctx,
        )
}

fn r3f_owned_root_collect_resource_aliases(
    owner_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    access_path: &R3fOwnedRootAccessPath,
    ctx: &crate::context::LintContext<'_>,
) -> rustc_hash::FxHashSet<oxc_semantic::SymbolId> {
    if matches!(access_path, R3fOwnedRootAccessPath::Direct) {
        return owner_symbol_ids.clone();
    }
    let mut resource_ids = rustc_hash::FxHashSet::default();
    for &symbol_id in owner_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx
                .nodes()
                .parent_node(transparent_expression_root(reference_node, ctx).id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                continue;
            };
            if member.object().span() != transparent_expression_root(reference_node, ctx).span()
                || !r3f_owned_root_member_node_matches_path(member_node, access_path)
            {
                continue;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            let declaration = ctx.nodes().parent_node(member_root.id());
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != member_root.span())
            {
                continue;
            }
            if let Some(binding) = declarator.id.get_binding_identifier() {
                resource_ids.extend(r3f_root_collect_alias_symbol_ids(binding.symbol_id(), ctx));
            }
        }
    }
    resource_ids
}

fn r3f_owned_root_member_matches_path(
    member: &oxc_ast::ast::MemberExpression<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(name) => {
            member.static_property_name().as_deref() == Some(name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member,
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member)
                if matches!(member.expression.get_inner_expression(), oxc_ast::ast::Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}

fn r3f_owned_root_member_node_matches_path(
    member_node: &crate::AstNode<'_>,
    access_path: &R3fOwnedRootAccessPath,
) -> bool {
    match access_path {
        R3fOwnedRootAccessPath::Direct => false,
        R3fOwnedRootAccessPath::Object(name) => {
            member_node
                .kind()
                .as_member_expression_kind()
                .and_then(|member| member.static_property_name())
                .as_deref()
                == Some(name.as_str())
        }
        R3fOwnedRootAccessPath::Array(index) => matches!(
            member_node.kind(),
            oxc_ast::AstKind::ComputedMemberExpression(member)
                if matches!(member.expression.get_inner_expression(), oxc_ast::ast::Expression::NumericLiteral(literal) if literal.value == *index as f64)
        ),
    }
}
