use oxc_ast::{
    AstKind as R3fAnalyzedAstKind,
    ast::{Argument as R3fAnalyzedArgument, Expression as R3fAnalyzedExpression},
};

use crate::context::LintContext as R3fAnalyzedLintContext;

const R3F_ANALYZED_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_ANALYZED_REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

struct R3fAnalyzedAssignedExpressionCache<'a> {
    expressions_by_symbol_and_reference: rustc_hash::FxHashMap<
        (oxc_semantic::SymbolId, oxc_semantic::NodeId),
        Vec<&'a R3fAnalyzedExpression<'a>>,
    >,
}

impl Default for R3fAnalyzedAssignedExpressionCache<'_> {
    fn default() -> Self {
        Self {
            expressions_by_symbol_and_reference: rustc_hash::FxHashMap::default(),
        }
    }
}

fn r3f_analyzed_use_three_state_property_matches<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    property_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    r3f_analyzed_use_three_state_property_matches_inner(
        expression,
        property_name,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
        &mut Vec::new(),
    )
}

fn r3f_analyzed_use_three_state_property_matches_inner<'a>(
    expression: &'a R3fAnalyzedExpression<'a>,
    property_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &R3fAnalyzedLintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let R3fAnalyzedExpression::CallExpression(call_expression) = expression
        && r3f_analyzed_use_three_selector_returns_property(
            call_expression,
            property_name,
            analysis,
            node_index,
            ctx,
            resolution_cache,
            assigned_expression_cache,
        )
    {
        return true;
    }
    if let Some(member_expression) = expression.as_member_expression()
        && member_expression.static_property_name() == Some(property_name)
        && r3f_analyzed_resolves_to_whole_use_three_state(
            member_expression.object(),
            analysis,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
    {
        return true;
    }
    let R3fAnalyzedExpression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern.properties.iter().any(|property| {
            r3f_analyzed_property_key_matches(&property.key, property_name)
                && r3f_analyzed_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
        })
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            r3f_analyzed_resolves_to_whole_use_three_state(
                initializer,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        });
    }
    let Some(initializer) =
        r3f_analyzed_binding_initializer(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    r3f_analyzed_use_three_state_property_matches_inner(
        initializer,
        property_name,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        assigned_expression_cache,
        visited_symbol_ids,
    )
}

fn r3f_analyzed_resolves_to_whole_use_three_state<'a>(
    expression: &R3fAnalyzedExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &R3fAnalyzedLintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let R3fAnalyzedExpression::CallExpression(call_expression) = expression {
        return call_expression.arguments.is_empty()
            && module_api_reference_matches(
                &call_expression.callee,
                "useThree",
                &R3F_ANALYZED_PUBLIC_MODULES,
                analysis,
                ctx,
            );
    }
    let R3fAnalyzedExpression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    let Some(initializer) =
        r3f_analyzed_binding_initializer(&declarator.id, symbol_id, declarator.init.as_ref())
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    r3f_analyzed_resolves_to_whole_use_three_state(initializer, analysis, ctx, visited_symbol_ids)
}

fn r3f_analyzed_use_three_selector_returns_property<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    property_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &R3fAnalyzedLintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> bool {
    if !module_api_reference_matches(
        &call_expression.callee,
        "useThree",
        &R3F_ANALYZED_PUBLIC_MODULES,
        analysis,
        ctx,
    ) {
        return false;
    }
    let Some(selector_expression) = call_expression
        .arguments
        .first()
        .and_then(R3fAnalyzedArgument::as_expression)
    else {
        return false;
    };
    let Some(selector_function_id) = r3f_analyzed_react_callback_function_id(
        selector_expression,
        analysis,
        ctx,
        resolution_cache,
    ) else {
        return false;
    };
    r3f_analyzed_function_returns_property_on_every_path(
        selector_function_id,
        selector_function_id,
        property_name,
        node_index,
        ctx,
        assigned_expression_cache,
        &mut Vec::new(),
        &mut Vec::new(),
    )
}

fn r3f_analyzed_react_callback_function_id<'a>(
    expression: &'a R3fAnalyzedExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &R3fAnalyzedLintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    if let Some(function_id) =
        exact_local_function_id(expression, ctx, &mut Vec::new(), resolution_cache)
    {
        return Some(function_id);
    }
    let wrapper_call = r3f_analyzed_callback_wrapper_call(expression, ctx, &mut Vec::new())?;
    if !r3f_analyzed_react_use_callback_matches(wrapper_call, analysis, ctx) {
        return None;
    }
    exact_local_function_id(
        wrapper_call.arguments.first()?.as_expression()?,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )
}

fn r3f_analyzed_callback_wrapper_call<'a>(
    expression: &'a R3fAnalyzedExpression<'a>,
    ctx: &R3fAnalyzedLintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let R3fAnalyzedExpression::CallExpression(call_expression) = expression {
        return Some(call_expression);
    }
    let R3fAnalyzedExpression::Identifier(identifier) = expression else {
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
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    r3f_analyzed_callback_wrapper_call(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn r3f_analyzed_react_use_callback_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &R3fAnalyzedLintContext<'a>,
) -> bool {
    let direct_match = if call_expression.callee.as_member_expression().is_some() {
        is_react_api_call(call_expression, "useCallback", ctx)
            && !r3f_analyzed_is_global_react_namespace_call(call_expression, ctx)
    } else {
        let R3fAnalyzedExpression::Identifier(identifier) =
            call_expression.callee.get_inner_expression()
        else {
            return module_api_reference_matches(
                &call_expression.callee,
                "useCallback",
                &R3F_ANALYZED_REACT_RUNTIME_MODULES,
                analysis,
                ctx,
            );
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
        symbol_id.is_some_and(|symbol_id| {
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && R3F_ANALYZED_REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
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
        })
    };
    direct_match
        || module_api_reference_matches(
            &call_expression.callee,
            "useCallback",
            &R3F_ANALYZED_REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn r3f_analyzed_is_global_react_namespace_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    r3f_analyzed_is_global_identifier(member_expression.object(), "React", ctx)
}

fn r3f_analyzed_is_global_identifier(
    expression: &R3fAnalyzedExpression<'_>,
    identifier_name: &str,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        R3fAnalyzedExpression::Identifier(identifier)
            if identifier.name == identifier_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn r3f_analyzed_binding_initializer<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a R3fAnalyzedExpression<'a>>,
) -> Option<&'a R3fAnalyzedExpression<'a>> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(binding) => (binding.symbol_id()
            == symbol_id)
            .then_some(base_initializer)
            .flatten(),
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            r3f_analyzed_binding_initializer(&assignment.left, symbol_id, Some(&assignment.right))
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                let property_initializer = match &property.value {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                if let Some(initializer) = r3f_analyzed_binding_initializer(
                    &property.value,
                    symbol_id,
                    property_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                r3f_analyzed_binding_initializer(&rest.argument, symbol_id, base_initializer)
            })
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                let element_initializer = match element {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                if let Some(initializer) =
                    r3f_analyzed_binding_initializer(element, symbol_id, element_initializer)
                {
                    return Some(initializer);
                }
            }
            pattern
                .rest
                .as_ref()
                .and_then(|rest| r3f_analyzed_binding_initializer(&rest.argument, symbol_id, None))
        }
    }
}

fn r3f_analyzed_property_key_matches(
    property_key: &oxc_ast::ast::PropertyKey<'_>,
    property_name: &str,
) -> bool {
    if property_key_matches_name(property_key, property_name) {
        return true;
    }
    let oxc_ast::ast::PropertyKey::TemplateLiteral(template) = property_key else {
        return false;
    };
    template.expressions.is_empty()
        && template.quasis.first().is_some_and(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                == property_name
        })
}

fn r3f_analyzed_binding_pattern_symbol_id(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
) -> Option<oxc_semantic::SymbolId> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            r3f_analyzed_binding_pattern_symbol_id(&assignment.left)
        }
        _ => None,
    }
}

fn r3f_analyzed_function_returns_property_on_every_path<'a>(
    function_id: oxc_semantic::NodeId,
    selector_function_id: oxc_semantic::NodeId,
    property_name: &str,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &R3fAnalyzedLintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<oxc_semantic::NodeId>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> bool {
    if visited_function_ids.contains(&function_id) {
        return false;
    }
    visited_function_ids.push(function_id);
    if let R3fAnalyzedAstKind::ArrowFunctionExpression(function) =
        ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        let matches = r3f_analyzed_selector_expression_matches_property(
            expression,
            selector_function_id,
            property_name,
            node_index,
            ctx,
            assigned_expression_cache,
            visited_expression_ids,
            visited_function_ids,
        );
        visited_function_ids.pop();
        return matches;
    }
    let body_statements = match ctx.nodes().get_node(function_id).kind() {
        R3fAnalyzedAstKind::Function(function) => function
            .body
            .as_ref()
            .map(|body| body.statements.as_slice()),
        R3fAnalyzedAstKind::ArrowFunctionExpression(function) => function
            .body
            .as_function_body()
            .map(|body| body.statements.as_slice()),
        _ => None,
    };
    let Some(body_statements) = body_statements else {
        visited_function_ids.pop();
        return false;
    };
    let mut returned_expressions = Vec::new();
    let mut has_bare_return = false;
    for &candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        let R3fAnalyzedAstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if let Some(argument) = return_statement.argument.as_ref() {
            returned_expressions.push(argument);
        } else {
            has_bare_return = true;
        }
    }
    let matches = !has_bare_return
        && body_statements
            .iter()
            .any(|statement| statement_always_exits(statement))
        && !returned_expressions.is_empty()
        && returned_expressions.into_iter().all(|returned_expression| {
            r3f_analyzed_selector_expression_matches_property(
                returned_expression,
                selector_function_id,
                property_name,
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

fn r3f_analyzed_selector_expression_matches_property<'a>(
    expression: &R3fAnalyzedExpression<'a>,
    selector_function_id: oxc_semantic::NodeId,
    property_name: &str,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &R3fAnalyzedLintContext<'a>,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    visited_expression_ids: &mut Vec<oxc_semantic::NodeId>,
    visited_function_ids: &mut Vec<oxc_semantic::NodeId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if r3f_analyzed_callback_state_property_matches(
        expression,
        selector_function_id,
        property_name,
        ctx,
        &mut Vec::new(),
    ) {
        return true;
    }
    let expression_id = expression.node_id();
    if visited_expression_ids.contains(&expression_id) {
        return false;
    }
    visited_expression_ids.push(expression_id);
    let matches = match expression {
        R3fAnalyzedExpression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                visited_expression_ids.pop();
                return false;
            };
            let assigned_expressions = r3f_analyzed_possible_assigned_expressions(
                identifier,
                symbol_id,
                ctx,
                assigned_expression_cache,
            );
            !assigned_expressions.is_empty()
                && assigned_expressions.into_iter().all(|assigned_expression| {
                    !matches!(
                        assigned_expression.get_inner_expression(),
                        R3fAnalyzedExpression::ArrowFunctionExpression(_)
                            | R3fAnalyzedExpression::FunctionExpression(_)
                    ) && r3f_analyzed_selector_expression_matches_property(
                        assigned_expression,
                        selector_function_id,
                        property_name,
                        node_index,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                })
        }
        R3fAnalyzedExpression::CallExpression(call_expression)
            if call_expression.arguments.is_empty() =>
        {
            r3f_analyzed_zero_argument_helper_id(&call_expression.callee, ctx).is_some_and(
                |function_id| {
                    r3f_analyzed_function_returns_property_on_every_path(
                        function_id,
                        selector_function_id,
                        property_name,
                        node_index,
                        ctx,
                        assigned_expression_cache,
                        visited_expression_ids,
                        visited_function_ids,
                    )
                },
            )
        }
        R3fAnalyzedExpression::ConditionalExpression(conditional_expression) => {
            r3f_analyzed_selector_expression_matches_property(
                &conditional_expression.consequent,
                selector_function_id,
                property_name,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_analyzed_selector_expression_matches_property(
                &conditional_expression.alternate,
                selector_function_id,
                property_name,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        R3fAnalyzedExpression::LogicalExpression(logical_expression) => {
            r3f_analyzed_selector_expression_matches_property(
                &logical_expression.left,
                selector_function_id,
                property_name,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            ) && r3f_analyzed_selector_expression_matches_property(
                &logical_expression.right,
                selector_function_id,
                property_name,
                node_index,
                ctx,
                assigned_expression_cache,
                visited_expression_ids,
                visited_function_ids,
            )
        }
        _ => false,
    };
    visited_expression_ids.pop();
    matches
}

fn r3f_analyzed_zero_argument_helper_id(
    callee: &R3fAnalyzedExpression<'_>,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    let R3fAnalyzedExpression::Identifier(identifier) = callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        R3fAnalyzedAstKind::Function(function)
            if !function.r#async && !function.generator && function.params.items.is_empty() =>
        {
            Some(declaration.id())
        }
        R3fAnalyzedAstKind::VariableDeclarator(declarator)
            if matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
        {
            match declarator.init.as_ref()?.get_inner_expression() {
                R3fAnalyzedExpression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    Some(function.node_id.get())
                }
                R3fAnalyzedExpression::FunctionExpression(function)
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

fn r3f_analyzed_callback_state_property_matches<'a>(
    expression: &R3fAnalyzedExpression<'a>,
    callback_id: oxc_semantic::NodeId,
    property_name: &str,
    ctx: &R3fAnalyzedLintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression.static_property_name() == Some(property_name)
            && r3f_analyzed_resolves_to_callback_state(
                member_expression.object(),
                callback_id,
                ctx,
                visited_symbol_ids,
            );
    }
    let R3fAnalyzedExpression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_analyzed_callback_parameter_property_symbol_matches(
        callback_id,
        symbol_id,
        property_name,
        ctx,
    ) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern.properties.iter().any(|property| {
            r3f_analyzed_property_key_matches(&property.key, property_name)
                && r3f_analyzed_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
        })
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            r3f_analyzed_resolves_to_callback_state(
                initializer,
                callback_id,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    if r3f_analyzed_binding_initializer(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|initializer| {
            r3f_analyzed_callback_state_property_matches(
                initializer,
                callback_id,
                property_name,
                ctx,
                visited_symbol_ids,
            )
        })
    {
        return true;
    }
    false
}

fn r3f_analyzed_resolves_to_callback_state<'a>(
    expression: &R3fAnalyzedExpression<'a>,
    callback_id: oxc_semantic::NodeId,
    ctx: &R3fAnalyzedLintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let R3fAnalyzedExpression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if r3f_analyzed_callback_parameter_symbol(callback_id, ctx) == Some(symbol_id) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        R3fAnalyzedAstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    r3f_analyzed_binding_initializer(&declarator.id, symbol_id, declarator.init.as_ref())
        .is_some_and(|initializer| {
            r3f_analyzed_resolves_to_callback_state(
                initializer,
                callback_id,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn r3f_analyzed_callback_parameter_symbol(
    callback_id: oxc_semantic::NodeId,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    r3f_analyzed_binding_pattern_symbol_id(r3f_analyzed_callback_first_parameter(callback_id, ctx)?)
}

fn r3f_analyzed_callback_parameter_property_symbol_matches(
    callback_id: oxc_semantic::NodeId,
    symbol_id: oxc_semantic::SymbolId,
    property_name: &str,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> bool {
    let Some(oxc_ast::ast::BindingPattern::ObjectPattern(pattern)) =
        r3f_analyzed_callback_first_parameter(callback_id, ctx)
    else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        r3f_analyzed_property_key_matches(&property.key, property_name)
            && r3f_analyzed_binding_pattern_symbol_id(&property.value) == Some(symbol_id)
    })
}

fn r3f_analyzed_callback_first_parameter<'a, 'ctx>(
    callback_id: oxc_semantic::NodeId,
    ctx: &'ctx R3fAnalyzedLintContext<'a>,
) -> Option<&'ctx oxc_ast::ast::BindingPattern<'a>> {
    let parameter = match ctx.nodes().get_node(callback_id).kind() {
        R3fAnalyzedAstKind::Function(function) => {
            function.params.items.first().map(|item| &item.pattern)
        }
        R3fAnalyzedAstKind::ArrowFunctionExpression(function) => {
            function.params.items.first().map(|item| &item.pattern)
        }
        _ => None,
    }?;
    match parameter {
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => Some(&assignment.left),
        parameter => Some(parameter),
    }
}

fn r3f_analyzed_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &R3fAnalyzedLintContext<'a>,
    cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
) -> Vec<&'a R3fAnalyzedExpression<'a>> {
    let cache_key = (symbol_id, identifier.node_id.get());
    if let Some(expressions) = cache.expressions_by_symbol_and_reference.get(&cache_key) {
        return expressions.clone();
    }
    let expressions =
        r3f_analyzed_compute_possible_assigned_expressions(identifier, symbol_id, ctx);
    cache
        .expressions_by_symbol_and_reference
        .insert(cache_key, expressions.clone());
    expressions
}

fn r3f_analyzed_compute_possible_assigned_expressions<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &R3fAnalyzedLintContext<'a>,
) -> Vec<&'a R3fAnalyzedExpression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let R3fAnalyzedAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return Vec::new();
    }
    let R3fAnalyzedAstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return Vec::new();
    };
    if variable_declaration.kind.is_const() {
        return declarator.init.iter().collect();
    }
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) {
        return Vec::new();
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
            r3f_analyzed_definition_is_conditional(declaration, ctx),
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
        let R3fAnalyzedAstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
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
            r3f_analyzed_definition_is_conditional(assignment_target_root, ctx),
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
                if reachable_blocks.contains(&source) {
                    incoming.extend(
                        outgoing_by_block
                            .get(&source)
                            .into_iter()
                            .flatten()
                            .copied(),
                    );
                }
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
    let definitions_before_reference = definitions_by_block
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
        &definitions_before_reference,
    )
    .into_iter()
    .map(|definition_id| definitions[definition_id].0)
    .collect()
}

fn r3f_analyzed_definition_is_conditional(
    node: &crate::AstNode<'_>,
    ctx: &R3fAnalyzedLintContext<'_>,
) -> bool {
    let block_id = ctx.nodes().cfg_id(node.id());
    for parent in ctx.nodes().ancestors(node.id()) {
        if ctx.nodes().cfg_id(parent.id()) != block_id {
            break;
        }
        if matches!(
            parent.kind(),
            R3fAnalyzedAstKind::ConditionalExpression(_) | R3fAnalyzedAstKind::LogicalExpression(_)
        ) {
            return true;
        }
    }
    false
}
