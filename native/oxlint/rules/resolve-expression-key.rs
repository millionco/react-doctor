fn resolve_expression_key(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return Some(format!("global:{}", identifier.name));
        };
        let symbol_key = format!("symbol:{}", symbol_id.index());
        if visited_symbol_ids.contains(&symbol_id) {
            return Some(symbol_key);
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_key);
        };
        if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
            && let Some(property_name) = pattern.properties.iter().find_map(|property| {
                matches!(
                    &property.value,
                    oxc_ast::ast::BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id
                )
                .then(|| resolve_expression_key_property_name(&property.key, property.computed))
                .flatten()
                .filter(|property_name| !property_name.is_empty())
            })
        {
            return declarator
                .init
                .as_ref()
                .and_then(|initializer| {
                    resolve_expression_key(initializer, ctx, visited_symbol_ids)
                })
                .map_or(Some(symbol_key), |object_key| {
                    Some(format!("{object_key}.{property_name}"))
                });
        }
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return Some(symbol_key);
        }
        let Some(initializer) = resolve_expression_key_binding_initializer(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ) else {
            return Some(symbol_key);
        };
        let initializer = initializer.get_inner_expression();
        if matches!(
            initializer,
            oxc_ast::ast::Expression::Identifier(_)
                | oxc_ast::ast::Expression::ComputedMemberExpression(_)
                | oxc_ast::ast::Expression::StaticMemberExpression(_)
                | oxc_ast::ast::Expression::PrivateFieldExpression(_)
        ) {
            return resolve_expression_key(initializer, ctx, visited_symbol_ids)
                .or(Some(symbol_key));
        }
        return Some(symbol_key);
    }
    if let Some(member_expression) = expression.as_member_expression() {
        let property_name = resolve_expression_key_member_property_name(member_expression)?;
        if property_name.is_empty() {
            return None;
        }
        let object_key =
            resolve_expression_key(member_expression.object(), ctx, visited_symbol_ids)?;
        return Some(format!("{object_key}.{property_name}"));
    }
    match expression {
        oxc_ast::ast::Expression::ThisExpression(_) => Some("this".to_string()),
        oxc_ast::ast::Expression::StringLiteral(literal) => {
            Some(format!("literal:{}", literal.value))
        }
        oxc_ast::ast::Expression::NumericLiteral(literal) => Some(format!(
            "literal:{}",
            format_javascript_number(literal.value)
        )),
        oxc_ast::ast::Expression::ArrowFunctionExpression(function) => {
            Some(format!("function:{}", function.span.start))
        }
        oxc_ast::ast::Expression::FunctionExpression(function) => {
            Some(format!("function:{}", function.span.start))
        }
        _ => None,
    }
}

fn resolve_expression_key_member_property_name(
    member_expression: &oxc_ast::ast::MemberExpression<'_>,
) -> Option<String> {
    match member_expression {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.to_string())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            resolve_expression_key_computed_expression_name(&member.expression)
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn resolve_expression_key_property_name(
    property_key: &oxc_ast::ast::PropertyKey<'_>,
    is_computed: bool,
) -> Option<String> {
    if is_computed {
        return None;
    }
    match property_key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => {
            Some(identifier.name.to_string())
        }
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

fn resolve_expression_key_binding_initializer<'a>(
    pattern: &'a oxc_ast::ast::BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a oxc_ast::ast::Expression<'a>>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(binding) => {
            (binding.symbol_id() == symbol_id)
                .then_some(base_initializer)
                .flatten()
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            resolve_expression_key_binding_initializer(
                &assignment.left,
                symbol_id,
                Some(&assignment.right),
            )
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                let property_initializer = match &property.value {
                    oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
                        Some(&assignment.right)
                    }
                    _ => base_initializer,
                };
                if let Some(initializer) = resolve_expression_key_binding_initializer(
                    &property.value,
                    symbol_id,
                    property_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                resolve_expression_key_binding_initializer(
                    &rest.argument,
                    symbol_id,
                    base_initializer,
                )
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
                if let Some(initializer) = resolve_expression_key_binding_initializer(
                    element,
                    symbol_id,
                    element_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                resolve_expression_key_binding_initializer(&rest.argument, symbol_id, None)
            })
        }
    }
}

fn resolve_expression_key_computed_expression_name(
    expression: &oxc_ast::ast::Expression<'_>,
) -> Option<String> {
    match expression {
        oxc_ast::ast::Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        oxc_ast::ast::Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string()
            })
        }
        _ => None,
    }
}
