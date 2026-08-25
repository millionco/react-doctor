fn generated_image_jsx_opening_element_ids<'a>(
    ctx: &crate::context::LintContext<'a>,
) -> std::collections::HashSet<oxc_semantic::NodeId> {
    let mut generated_opening_element_ids = std::collections::HashSet::new();
    if !ctx.module_record().import_entries.iter().any(|entry| {
        matches!(
            entry.module_request.name(),
            "next/og" | "@vercel/og" | "satori"
        )
    }) {
        return generated_opening_element_ids;
    }
    for node in ctx.nodes().iter() {
        let arguments = match node.kind() {
            oxc_ast::AstKind::CallExpression(call)
                if is_generated_image_renderer_callee(&call.callee, ctx) =>
            {
                &call.arguments
            }
            oxc_ast::AstKind::NewExpression(call)
                if is_generated_image_renderer_callee(&call.callee, ctx) =>
            {
                &call.arguments
            }
            _ => continue,
        };
        for argument in arguments {
            let Some(expression) = argument.as_expression() else {
                continue;
            };
            mark_generated_image_expression(
                expression,
                ctx,
                &mut generated_opening_element_ids,
                &mut Vec::new(),
            );
        }
    }
    generated_opening_element_ids
}

fn is_generated_image_renderer_callee<'a>(
    callee: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if imported_module_api_matches(callee, "ImageResponse", "next/og", ctx)
        || imported_module_api_matches(callee, "ImageResponse", "@vercel/og", ctx)
    {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return false;
    };
    resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
        entry.module_request.name() == "satori"
            && match &entry.import_name {
                crate::module_record::ImportImportName::Default(_) => true,
                crate::module_record::ImportImportName::Name(imported_name) => {
                    imported_name.name() == "satori"
                }
                crate::module_record::ImportImportName::NamespaceObject => false,
            }
    })
}

fn mark_generated_image_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    generated_opening_element_ids: &mut std::collections::HashSet<oxc_semantic::NodeId>,
    visited_names: &mut Vec<String>,
) {
    use oxc_ast::ast::Expression;
    let expression = expression.get_inner_expression();
    match expression {
        Expression::JSXElement(element) => mark_generated_image_jsx_subtree(
            element.span,
            ctx,
            generated_opening_element_ids,
            visited_names,
        ),
        Expression::JSXFragment(fragment) => mark_generated_image_jsx_subtree(
            fragment.span,
            ctx,
            generated_opening_element_ids,
            visited_names,
        ),
        Expression::ArrowFunctionExpression(function) => mark_generated_image_function(
            function.node_id.get(),
            ctx,
            generated_opening_element_ids,
            visited_names,
        ),
        Expression::FunctionExpression(function) => mark_generated_image_function(
            function.node_id.get(),
            ctx,
            generated_opening_element_ids,
            visited_names,
        ),
        Expression::ConditionalExpression(conditional) => {
            mark_generated_image_expression(
                &conditional.consequent,
                ctx,
                generated_opening_element_ids,
                visited_names,
            );
            mark_generated_image_expression(
                &conditional.alternate,
                ctx,
                generated_opening_element_ids,
                visited_names,
            );
        }
        Expression::LogicalExpression(logical) => {
            mark_generated_image_expression(
                &logical.left,
                ctx,
                generated_opening_element_ids,
                visited_names,
            );
            mark_generated_image_expression(
                &logical.right,
                ctx,
                generated_opening_element_ids,
                visited_names,
            );
        }
        Expression::CallExpression(call) => {
            match call.callee.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => mark_generated_image_function(
                    function.node_id.get(),
                    ctx,
                    generated_opening_element_ids,
                    visited_names,
                ),
                Expression::FunctionExpression(function) => mark_generated_image_function(
                    function.node_id.get(),
                    ctx,
                    generated_opening_element_ids,
                    visited_names,
                ),
                Expression::Identifier(identifier)
                    if !has_normal_generated_image_jsx_usage(
                        identifier.name.as_str(),
                        generated_opening_element_ids,
                        ctx,
                    ) && !has_normal_generated_image_function_call_usage(
                        identifier.name.as_str(),
                        ctx,
                    ) =>
                {
                    mark_generated_image_identifier(
                        identifier,
                        ctx,
                        generated_opening_element_ids,
                        visited_names,
                    );
                }
                _ => {}
            }
        }
        Expression::Identifier(identifier) => mark_generated_image_identifier(
            identifier,
            ctx,
            generated_opening_element_ids,
            visited_names,
        ),
        _ => {}
    }
}

fn mark_generated_image_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &crate::context::LintContext<'a>,
    generated_opening_element_ids: &mut std::collections::HashSet<oxc_semantic::NodeId>,
    visited_names: &mut Vec<String>,
) {
    if visited_names
        .iter()
        .any(|name| name == identifier.name.as_str())
    {
        return;
    }
    visited_names.push(identifier.name.to_string());
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        oxc_ast::AstKind::VariableDeclarator(declarator) => {
            if let Some(initializer) = &declarator.init {
                mark_generated_image_expression(
                    initializer,
                    ctx,
                    generated_opening_element_ids,
                    visited_names,
                );
            }
        }
        oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_) => {
            mark_generated_image_function(
                declaration.id(),
                ctx,
                generated_opening_element_ids,
                visited_names,
            );
        }
        _ => {}
    }
}

fn mark_generated_image_function<'a>(
    function_node_id: oxc_semantic::NodeId,
    ctx: &crate::context::LintContext<'a>,
    generated_opening_element_ids: &mut std::collections::HashSet<oxc_semantic::NodeId>,
    visited_names: &mut Vec<String>,
) {
    use oxc_span::GetSpan;
    let function_node = ctx.nodes().get_node(function_node_id);
    if let oxc_ast::AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        mark_generated_image_expression(
            expression,
            ctx,
            generated_opening_element_ids,
            visited_names,
        );
        return;
    }
    let function_span = function_node.span();
    let returned_expressions = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let oxc_ast::AstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            if !function_span.contains_inclusive(candidate.span())
                || ctx
                    .nodes()
                    .ancestors(candidate.id())
                    .find(|ancestor| {
                        matches!(
                            ancestor.kind(),
                            oxc_ast::AstKind::Function(_)
                                | oxc_ast::AstKind::ArrowFunctionExpression(_)
                        )
                    })
                    .is_none_or(|ancestor| ancestor.id() != function_node_id)
            {
                return None;
            }
            statement.argument.as_ref()
        })
        .collect::<Vec<_>>();
    for expression in returned_expressions {
        mark_generated_image_expression(
            expression,
            ctx,
            generated_opening_element_ids,
            visited_names,
        );
    }
}

fn mark_generated_image_jsx_subtree<'a>(
    root_span: oxc_span::Span,
    ctx: &crate::context::LintContext<'a>,
    generated_opening_element_ids: &mut std::collections::HashSet<oxc_semantic::NodeId>,
    visited_names: &mut Vec<String>,
) {
    use oxc_span::GetSpan;
    let opening_element_ids = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            matches!(candidate.kind(), oxc_ast::AstKind::JSXOpeningElement(_))
                && root_span.contains_inclusive(candidate.span())
        })
        .map(crate::AstNode::id)
        .collect::<Vec<_>>();
    for opening_element_id in opening_element_ids {
        generated_opening_element_ids.insert(opening_element_id);
        let opening_element_node = ctx.nodes().get_node(opening_element_id);
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = opening_element_node.kind()
        else {
            continue;
        };
        mark_generated_image_component(
            opening_element,
            ctx,
            generated_opening_element_ids,
            visited_names,
        );
    }
}

fn mark_generated_image_component<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
    generated_opening_element_ids: &mut std::collections::HashSet<oxc_semantic::NodeId>,
    visited_names: &mut Vec<String>,
) {
    let oxc_ast::ast::JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
        return;
    };
    let component_name = identifier.name.as_str();
    if component_name
        .chars()
        .next()
        .is_none_or(|character| character.to_uppercase().ne(std::iter::once(character)))
        || visited_names.iter().any(|name| name == component_name)
        || has_normal_generated_image_jsx_usage(
            component_name,
            generated_opening_element_ids,
            ctx,
        )
    {
        return;
    }
    mark_generated_image_identifier(
        identifier,
        ctx,
        generated_opening_element_ids,
        visited_names,
    );
}

fn has_normal_generated_image_jsx_usage(
    component_name: &str,
    generated_opening_element_ids: &std::collections::HashSet<oxc_semantic::NodeId>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        !generated_opening_element_ids.contains(&candidate.id())
            && match &opening_element.name {
                oxc_ast::ast::JSXElementName::Identifier(identifier) => {
                    identifier.name == component_name
                }
                oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
                    identifier.name == component_name
                }
                _ => false,
            }
    })
}

fn has_normal_generated_image_function_call_usage(
    function_name: &str,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let oxc_ast::AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        matches!(
            call.callee.get_inner_expression(),
            oxc_ast::ast::Expression::Identifier(identifier)
                if identifier.name == function_name
        ) && !ctx.nodes().ancestors(candidate.id()).any(|ancestor| {
            match ancestor.kind() {
                oxc_ast::AstKind::CallExpression(call) => {
                    is_generated_image_renderer_callee(&call.callee, ctx)
                }
                oxc_ast::AstKind::NewExpression(call) => {
                    is_generated_image_renderer_callee(&call.callee, ctx)
                }
                _ => false,
            }
        })
    })
}
