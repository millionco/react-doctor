use oxc_span::GetSpan;

const SYNCHRONOUS_ITERATION_METHOD_NAMES: [&str; 14] = [
    "map",
    "filter",
    "forEach",
    "flatMap",
    "reduce",
    "reduceRight",
    "some",
    "every",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "sort",
    "toSorted",
];

fn is_render_phase_component_or_hook<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(mut function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    loop {
        if is_component_or_hook_function(function_node, ctx) {
            return true;
        }
        if !function_executes_during_render(function_node, ctx) {
            return false;
        }
        let Some(outer_function) = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
            )
        }) else {
            return false;
        };
        function_node = outer_function;
    }
}

fn is_component_or_hook_function<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if let oxc_ast::AstKind::Function(function) = function_node.kind()
        && function.id.as_ref().is_some_and(|identifier| {
            crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
        })
    {
        return true;
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        let is_first_argument = call_expression.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        });
        if !is_first_argument
            || !matches!(
                call_expression.callee_name(),
                Some("memo" | "forwardRef" | "observer" | "lazy")
            )
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    let oxc_ast::AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|identifier| {
            crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
        })
}

fn function_executes_during_render<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    if let oxc_ast::AstKind::NewExpression(new_expression) = parent.kind() {
        return expression_is_argument_at(&new_expression.arguments, 0, expression_root.span())
            && matches!(
                new_expression.callee.get_inner_expression(),
                oxc_ast::ast::Expression::Identifier(identifier)
                    if identifier.name == "Promise"
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
            );
    }
    let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if call_expression.callee.span() == expression_root.span() {
        return true;
    }
    if expression_is_argument_at(&call_expression.arguments, 0, expression_root.span()) {
        if is_react_api_call(call_expression, "useMemo", ctx)
            || is_react_api_call(call_expression, "useState", ctx)
            || is_react_api_call(call_expression, "startTransition", ctx)
        {
            return true;
        }
        if let Some(member_expression) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
            && member_expression
                .static_property_name()
                .is_some_and(|property_name| {
                    SYNCHRONOUS_ITERATION_METHOD_NAMES.contains(&property_name)
                })
        {
            return true;
        }
    }
    expression_is_argument_at(&call_expression.arguments, 1, expression_root.span())
        && is_global_array_from_call(call_expression, ctx)
}

fn is_global_array_from_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if is_global_array_from_member(callee, ctx) {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = callee else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    matches!(
        parent.kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| is_global_array_from_member(initializer, ctx))
}

fn is_global_array_from_member<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(member_expression) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    member_expression.static_property_name() == Some("from")
        && identifier.name == "Array"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn expression_is_argument_at(
    arguments: &[oxc_ast::ast::Argument<'_>],
    argument_index: usize,
    expression_span: oxc_span::Span,
) -> bool {
    arguments.get(argument_index).is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == expression_span)
    })
}

fn transparent_expression_root<'a, 'b>(
    mut node: &'b crate::AstNode<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> &'b crate::AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(
            parent.kind(),
            oxc_ast::AstKind::ParenthesizedExpression(_)
                | oxc_ast::AstKind::TSAsExpression(_)
                | oxc_ast::AstKind::TSSatisfiesExpression(_)
                | oxc_ast::AstKind::TSTypeAssertion(_)
                | oxc_ast::AstKind::TSNonNullExpression(_)
                | oxc_ast::AstKind::TSInstantiationExpression(_)
                | oxc_ast::AstKind::ChainExpression(_)
        ) {
            return node;
        }
        node = parent;
    }
}
