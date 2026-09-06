use oxc_ast::AstKind;
use oxc_span::GetSpan;

fn function_contains_react_render_output<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let function_span = function_node.span();
    ctx.nodes().iter().any(|candidate| {
        function_span.contains_inclusive(candidate.span())
            && is_react_render_output_node(candidate, ctx)
            && render_output_reaches_function_return(candidate, function_node, ctx)
    })
}

fn is_react_render_output_node<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    match node.kind() {
        AstKind::JSXElement(_) | AstKind::JSXFragment(_) => true,
        AstKind::CallExpression(call_expression) => {
            is_react_api_call(call_expression, "createElement", ctx)
                || imported_module_api_matches(
                    &call_expression.callee,
                    "createPortal",
                    "react-dom",
                    ctx,
                )
        }
        _ => false,
    }
}

fn render_output_reaches_function_return<'a>(
    output_node: &crate::AstNode<'a>,
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let mut current = output_node;
    let mut reached_return = false;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == function_node.id() {
            return reached_return
                || function_has_expression_body(function_node, output_node.span())
                || render_output_flows_through_returned_symbol(output_node, function_node, ctx);
        }
        match parent.kind() {
            AstKind::ReturnStatement(return_statement)
                if return_statement.argument.as_ref().is_some_and(|argument| {
                    argument.span().contains_inclusive(output_node.span())
                }) =>
            {
                reached_return = true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                if !is_directly_returned_function(parent, function_node, ctx)
                    && !is_render_preserving_callback(parent, ctx)
                {
                    return false;
                }
                reached_return = false;
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
        current = parent;
    }
}

fn render_output_flows_through_returned_symbol<'a>(
    output_node: &crate::AstNode<'a>,
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some((symbol_id, assignment_offset)) =
        assigned_symbol_for_render_output(output_node, function_node, ctx)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .filter(|reference| {
            ctx.nodes().get_node(reference.node_id()).span().start > assignment_offset
        })
        .any(|reference| {
            ctx.nodes()
                .ancestors(reference.node_id())
                .take_while(|ancestor| ancestor.id() != function_node.id())
                .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
        })
}

fn assigned_symbol_for_render_output<'a>(
    output_node: &crate::AstNode<'a>,
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<(oxc_semantic::SymbolId, u32)> {
    for ancestor in ctx.nodes().ancestors(output_node.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    initializer.span().contains_inclusive(output_node.span())
                }) =>
            {
                let identifier = declarator.id.get_binding_identifier()?;
                return Some((identifier.symbol_id(), ancestor.span().start));
            }
            AstKind::AssignmentExpression(assignment)
                if assignment
                    .right
                    .span()
                    .contains_inclusive(output_node.span()) =>
            {
                let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                    &assignment.left
                else {
                    return None;
                };
                let symbol_id = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                return Some((symbol_id, ancestor.span().start));
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            _ => {}
        }
    }
    None
}

fn is_directly_returned_function<'a>(
    nested_function_node: &crate::AstNode<'a>,
    root_function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(nested_function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::ReturnStatement(return_statement) => return_statement
            .argument
            .as_ref()
            .is_some_and(|argument| argument.span() == expression_root.span()),
        AstKind::ArrowFunctionExpression(arrow_function) => {
            parent.id() == root_function_node.id()
                && arrow_function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == expression_root.span())
        }
        _ => false,
    }
}

fn function_has_expression_body(
    function_node: &crate::AstNode<'_>,
    output_span: oxc_span::Span,
) -> bool {
    matches!(
        function_node.kind(),
        AstKind::ArrowFunctionExpression(function)
            if function
                .get_expression()
                .is_some_and(|expression| expression.span().contains_inclusive(output_span))
    )
}

fn is_render_preserving_callback<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if !call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == expression_root.span())
    }) {
        return false;
    }
    if call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|expression| expression.span() == expression_root.span())
        && is_react_api_call(call_expression, "useMemo", ctx)
    {
        return true;
    }
    call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member_expression| member_expression.static_property_name() == Some("map"))
}
