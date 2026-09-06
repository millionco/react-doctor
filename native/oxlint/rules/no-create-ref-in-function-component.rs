use oxc_ast::ast::{Argument, Expression, JSXAttributeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`createRef()` may escape or be observed beyond the render that created it, so a later render can replace the ref object and detach the observed one. Hoist a `useRef()` call to the component's unconditional top level instead.";

#[derive(Debug, Default, Clone)]
pub struct NoCreateRefInFunctionComponent;

declare_oxc_lint!(
    /// Disallow observable createRef values in function components and hooks.
    NoCreateRefInFunctionComponent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow observable createRef values in function components and hooks.",
);

impl Rule for NoCreateRefInFunctionComponent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(create_ref_call) = node.kind() else {
            return;
        };
        if !is_create_ref_call(create_ref_call, ctx) {
            return;
        }
        let Some(render_function) = find_create_ref_render_function(node, ctx) else {
            return;
        };
        let Some(display_name) = component_or_hook_function_name(render_function, ctx) else {
            return;
        };
        if !crate::utils::is_react_hook_name(display_name)
            && !function_contains_react_render_output(render_function, ctx)
        {
            return;
        }
        if is_react_state_initializer(node, ctx)
            || function_is_exclusively_react_state_initializer(render_function, ctx)
            || is_proven_one_shot_testing_library_component(render_function, ctx)
            || is_create_ref_persisted_in_guarded_use_ref(node, render_function, ctx)
            || is_create_ref_result_write_only(node, render_function, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(create_ref_call.span));
    }
}

fn is_create_ref_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_api_call(call_expression, "createRef", ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    identifier.name == "createRef"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn create_ref_expression_is_argument_at(
    arguments: &[Argument<'_>],
    argument_index: usize,
    expression_span: oxc_span::Span,
) -> bool {
    arguments.get(argument_index).is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == expression_span)
    })
}

fn find_create_ref_render_function<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let mut enclosing_function = crate::ast_util::get_enclosing_function(node, ctx)?;
    while function_is_react_use_memo_callback(enclosing_function, ctx) {
        enclosing_function = ctx
            .nodes()
            .ancestors(enclosing_function.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })?;
    }
    Some(enclosing_function)
}

fn function_is_react_use_memo_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    matches!(
        parent.kind(),
        AstKind::CallExpression(call_expression)
            if create_ref_expression_is_argument_at(
                &call_expression.arguments,
                0,
                function_root.span(),
            )
                && is_react_api_call(call_expression, "useMemo", ctx)
    )
}

fn is_react_state_initializer<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    matches!(
        parent.kind(),
        AstKind::CallExpression(call_expression)
            if create_ref_expression_is_argument_at(
                &call_expression.arguments,
                0,
                expression_root.span(),
            )
                && is_react_api_call(call_expression, "useState", ctx)
    )
}

fn function_is_exclusively_react_state_initializer<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let direct_parent = ctx.nodes().parent_node(function_root.id());
    if matches!(
        direct_parent.kind(),
        AstKind::CallExpression(call_expression)
            if create_ref_expression_is_argument_at(
                &call_expression.arguments,
                0,
                function_root.span(),
            )
                && is_react_api_call(call_expression, "useState", ctx)
    ) {
        return true;
    }
    let Some(symbol_id) = function_binding_symbol(function_node, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if declaration_has_export_wrapper(declaration, ctx)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        return false;
    }
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            matches!(
                parent.kind(),
                AstKind::CallExpression(call_expression)
                    if create_ref_expression_is_argument_at(
                        &call_expression.arguments,
                        0,
                        reference_root.span(),
                    ) && is_react_api_call(call_expression, "useState", ctx)
            )
        })
}

fn function_binding_symbol<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<SymbolId> {
    match function_node.kind() {
        AstKind::Function(function) if function.is_declaration() => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let function_root = transparent_expression_root(function_node, ctx);
            let parent = ctx.nodes().parent_node(function_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            let binding = declarator.id.get_binding_identifier()?;
            if !matches!(
                ctx.nodes().parent_node(parent.id()).kind(),
                AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
            ) {
                return None;
            }
            Some(binding.symbol_id())
        }
        _ => None,
    }
}

fn declaration_has_export_wrapper(declaration: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(declaration.id());
    if matches!(
        parent.kind(),
        AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
    ) {
        return true;
    }
    matches!(declaration.kind(), AstKind::VariableDeclarator(_))
        && matches!(
            ctx.nodes().parent_node(parent.id()).kind(),
            AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
        )
}

fn is_proven_one_shot_testing_library_component<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !has_unit_test_filename(ctx) || !one_shot_component_body_is_safe(function_node, ctx) {
        return false;
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let declarator_node = ctx.nodes().parent_node(function_root.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != function_root.span())
    {
        return false;
    }
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    let declaration_node = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(
        declaration_node.kind(),
        AstKind::VariableDeclaration(declaration)
            if declaration.kind.is_const() && declaration.declarations.len() == 1
    ) {
        return false;
    }
    let Some(test_callback) = crate::ast_util::get_enclosing_function(declarator_node, ctx) else {
        return false;
    };
    if !is_proven_test_callback(test_callback, ctx)
        || !declaration_is_direct_function_body_statement(declaration_node, test_callback, ctx)
    {
        return false;
    }
    let references = ctx
        .scoping()
        .get_resolved_references(binding.symbol_id())
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|reference| {
            !reference.is_write()
                && independent_testing_library_render_for_component_reference(
                    ctx.nodes().get_node(reference.node_id()),
                    test_callback,
                    ctx,
                )
        })
}

fn has_unit_test_filename(ctx: &LintContext<'_>) -> bool {
    let filename = format!("/{}", ctx.file_path().to_string_lossy().replace('\\', "/"));
    let basename = filename.rsplit('/').next().unwrap_or_default();
    basename.contains(".test.")
        || basename.contains(".spec.")
        || filename.contains("/__tests__/")
        || filename.contains("/__test__/")
        || filename.contains("/__mocks__/")
}

fn one_shot_component_body_is_safe<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let (parameters, body) = match function_node.kind() {
        AstKind::Function(function) => (&function.params, function.body.as_deref()),
        AstKind::ArrowFunctionExpression(function) => {
            (&function.params, function.get_function_body())
        }
        _ => return false,
    };
    if parameters
        .items
        .iter()
        .any(|parameter| parameter.pattern.get_binding_identifier().is_none())
    {
        return false;
    }
    let Some(body) = body else {
        return false;
    };
    if !body.directives.is_empty() || body.statements.len() < 2 {
        return false;
    }
    let Some((return_statement, preceding_statements)) = body.statements.split_last() else {
        return false;
    };
    if !preceding_statements
        .iter()
        .all(|statement| one_shot_create_ref_declaration_is_safe(statement, ctx))
    {
        return false;
    }
    let oxc_ast::ast::Statement::ReturnStatement(return_statement) = return_statement else {
        return false;
    };
    let Some(returned_expression) = &return_statement.argument else {
        return false;
    };
    let returned_expression = returned_expression.get_inner_expression();
    if !matches!(
        returned_expression,
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) {
        return false;
    }
    ctx.nodes().iter().all(|candidate| {
        !returned_expression
            .span()
            .contains_inclusive(candidate.span())
            || !matches!(
                candidate.kind(),
                AstKind::Function(_)
                    | AstKind::ArrowFunctionExpression(_)
                    | AstKind::AssignmentExpression(_)
                    | AstKind::AwaitExpression(_)
                    | AstKind::CallExpression(_)
                    | AstKind::NewExpression(_)
                    | AstKind::TaggedTemplateExpression(_)
                    | AstKind::UpdateExpression(_)
                    | AstKind::YieldExpression(_)
            )
    })
}

fn one_shot_create_ref_declaration_is_safe<'a>(
    statement: &oxc_ast::ast::Statement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let oxc_ast::ast::Statement::VariableDeclaration(declaration) = statement else {
        return false;
    };
    declaration.kind.is_const()
        && !declaration.declarations.is_empty()
        && declaration.declarations.iter().all(|declarator| {
            declarator.id.get_binding_identifier().is_some()
                && matches!(
                    declarator.init.as_ref().map(Expression::get_inner_expression),
                    Some(Expression::CallExpression(call_expression))
                        if is_create_ref_call(call_expression, ctx)
                )
        })
}

fn is_proven_test_callback<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let call_node = ctx.nodes().parent_node(function_root.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    if !create_ref_expression_is_argument_at(&call_expression.arguments, 1, function_root.span()) {
        return false;
    }
    let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    if matches!(callee.name.as_str(), "it" | "test")
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none()
    {
        return true;
    }
    ["@jest/globals", "vitest"].iter().any(|module_source| {
        imported_module_api_matches(&call_expression.callee, "it", module_source, ctx)
            || imported_module_api_matches(&call_expression.callee, "test", module_source, ctx)
    })
}

fn declaration_is_direct_function_body_statement(
    declaration_node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let body_node = ctx.nodes().parent_node(declaration_node.id());
    matches!(body_node.kind(), AstKind::FunctionBody(_))
        && ctx.nodes().parent_node(body_node.id()).id() == function_node.id()
}

fn independent_testing_library_render_for_component_reference<'a>(
    reference_node: &AstNode<'a>,
    test_callback: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let opening_node = ctx.nodes().parent_node(reference_node.id());
    let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
        return false;
    };
    let element_node = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = element_node.kind() else {
        return false;
    };
    if !matches!(
        &opening_element.name,
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier)
            if identifier.span == reference_node.span()
    ) || element.closing_element.is_some()
        || !opening_element.attributes.is_empty()
    {
        return false;
    }
    let element_root = transparent_expression_root(element_node, ctx);
    let call_node = ctx.nodes().parent_node(element_root.id());
    let AstKind::CallExpression(render_call) = call_node.kind() else {
        return false;
    };
    if render_call.arguments.len() != 1
        || !create_ref_expression_is_argument_at(&render_call.arguments, 0, element_root.span())
        || !imported_module_api_matches(
            &render_call.callee,
            "render",
            "@testing-library/react",
            ctx,
        )
    {
        return false;
    }
    direct_safe_render_statement(call_node, test_callback, ctx)
}

fn direct_safe_render_statement<'a, 'b>(
    call_node: &'b AstNode<'a>,
    test_callback: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let call_root = transparent_expression_root(call_node, ctx);
    let parent = ctx.nodes().parent_node(call_root.id());
    let statement_node = match parent.kind() {
        AstKind::ExpressionStatement(_) => parent,
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == call_root.span())
                && safe_render_result_binding(&declarator.id) =>
        {
            let declaration = ctx.nodes().parent_node(parent.id());
            if !matches!(
                declaration.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.declarations.len() == 1
            ) {
                return false;
            }
            declaration
        }
        _ => return false,
    };
    declaration_is_direct_function_body_statement(statement_node, test_callback, ctx)
}

fn safe_render_result_binding(pattern: &oxc_ast::ast::BindingPattern<'_>) -> bool {
    let oxc_ast::ast::BindingPattern::ObjectPattern(object_pattern) = pattern else {
        return false;
    };
    object_pattern.rest.is_none()
        && object_pattern.properties.iter().all(|property| {
            !property.computed
                && property.value.get_binding_identifier().is_some()
                && property.key.static_name().as_deref() != Some("rerender")
        })
}

fn is_create_ref_persisted_in_guarded_use_ref<'a>(
    create_ref_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(assignment_node) = create_ref_persistence_assignment(create_ref_node, ctx) else {
        return false;
    };
    let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
        return false;
    };
    let Some(assigned_member) = assignment.left.as_member_expression() else {
        return false;
    };
    if assigned_member.static_property_name() != Some("current") {
        return false;
    }
    let Expression::Identifier(receiver) = assigned_member.object().get_inner_expression() else {
        return false;
    };
    let Some(ref_symbol_id) = ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != ref_symbol_id)
        || crate::ast_util::get_enclosing_function(declaration, ctx)
            .is_none_or(|function| function.id() != render_function.id())
    {
        return false;
    }
    let Some(Expression::CallExpression(use_ref_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !is_react_api_call(use_ref_call, "useRef", ctx)
        || use_ref_call.arguments.len() > 1
        || !node_is_unconditional_within_function(declaration, render_function, ctx)
    {
        return false;
    }
    let Some(initial_value) = empty_ref_value_kind(use_ref_call.arguments.first(), ctx) else {
        return false;
    };
    let Some(guard_node) = direct_assignment_guard(assignment_node, ctx) else {
        return false;
    };
    let AstKind::IfStatement(guard) = guard_node.kind() else {
        return false;
    };
    if !guard_proves_empty_ref(&guard.test, ref_symbol_id, initial_value, ctx) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(ref_symbol_id)
        .all(|reference| {
            if reference.is_write() {
                return false;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            persistent_ref_reference_is_safe(reference_node, assignment_node, ctx)
        })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EmptyRefValue {
    False,
    Null,
    Undefined,
}

fn empty_ref_value_kind(
    argument: Option<&Argument<'_>>,
    ctx: &LintContext<'_>,
) -> Option<EmptyRefValue> {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return Some(EmptyRefValue::Undefined);
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => Some(EmptyRefValue::Null),
        Expression::BooleanLiteral(literal) if !literal.value => Some(EmptyRefValue::False),
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            Some(EmptyRefValue::Undefined)
        }
        _ => None,
    }
}

fn create_ref_persistence_assignment<'a, 'b>(
    create_ref_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let mut current = transparent_expression_root(create_ref_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign
                    && assignment.right.span() == current.span() =>
            {
                return Some(parent);
            }
            AstKind::ObjectProperty(property) if property.value.span() == current.span() => {
                let object_node = ctx.nodes().parent_node(parent.id());
                if !matches!(object_node.kind(), AstKind::ObjectExpression(_)) {
                    return None;
                }
                current = transparent_expression_root(object_node, ctx);
            }
            _ => return None,
        }
    }
}

fn direct_assignment_guard<'a, 'b>(
    assignment_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let statement = ctx.nodes().parent_node(assignment_node.id());
    if !matches!(statement.kind(), AstKind::ExpressionStatement(_)) {
        return None;
    }
    let container = ctx.nodes().parent_node(statement.id());
    match container.kind() {
        AstKind::IfStatement(if_statement)
            if if_statement.consequent.span() == statement.span() =>
        {
            Some(container)
        }
        AstKind::BlockStatement(block) if block.body.len() == 1 => {
            let guard = ctx.nodes().parent_node(container.id());
            matches!(
                guard.kind(),
                AstKind::IfStatement(if_statement)
                    if if_statement.consequent.span() == container.span()
            )
            .then_some(guard)
        }
        _ => None,
    }
}

fn guard_proves_empty_ref<'a>(
    expression: &Expression<'a>,
    symbol_id: SymbolId,
    initial_value: EmptyRefValue,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            expression_is_current_for_symbol(&unary.argument, symbol_id, ctx)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) =>
        {
            let compared_value = if expression_is_current_for_symbol(&binary.left, symbol_id, ctx) {
                empty_ref_expression_kind(&binary.right, ctx)
            } else if expression_is_current_for_symbol(&binary.right, symbol_id, ctx) {
                empty_ref_expression_kind(&binary.left, ctx)
            } else {
                None
            };
            compared_value.is_some_and(|compared_value| {
                if binary.operator == BinaryOperator::StrictEquality {
                    compared_value == initial_value
                } else {
                    matches!(
                        compared_value,
                        EmptyRefValue::Null | EmptyRefValue::Undefined
                    ) && matches!(
                        initial_value,
                        EmptyRefValue::Null | EmptyRefValue::Undefined
                    )
                }
            })
        }
        _ => false,
    }
}

fn empty_ref_expression_kind(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<EmptyRefValue> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => Some(EmptyRefValue::Null),
        Expression::BooleanLiteral(literal) if !literal.value => Some(EmptyRefValue::False),
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            Some(EmptyRefValue::Undefined)
        }
        _ => None,
    }
}

fn expression_is_current_for_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    member.static_property_name() == Some("current")
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(symbol_id)
}

fn node_is_unconditional_within_function(
    node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|ancestor| ancestor.id() != function_node.id())
        .all(|ancestor| {
            !matches!(
                ancestor.kind(),
                AstKind::IfStatement(_)
                    | AstKind::ConditionalExpression(_)
                    | AstKind::LogicalExpression(_)
                    | AstKind::SwitchStatement(_)
                    | AstKind::TryStatement(_)
                    | AstKind::WhileStatement(_)
                    | AstKind::DoWhileStatement(_)
                    | AstKind::ForStatement(_)
                    | AstKind::ForInStatement(_)
                    | AstKind::ForOfStatement(_)
            )
        })
}

fn persistent_ref_reference_is_safe<'a>(
    reference_node: &AstNode<'a>,
    persistence_assignment: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let member_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::StaticMemberExpression(member) = member_node.kind() else {
        return false;
    };
    if member.object.span() != reference_root.span() || member.property.name != "current" {
        return false;
    }
    let member_root = transparent_expression_root(member_node, ctx);
    let parent = ctx.nodes().parent_node(member_root.id());
    if matches!(parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span() == member_root.span())
    {
        return parent.id() == persistence_assignment.id();
    }
    true
}

fn is_create_ref_result_write_only<'a>(
    create_ref_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(owned_value) = find_owned_create_ref_value(create_ref_node, ctx) else {
        let create_ref_root = transparent_expression_root(create_ref_node, ctx);
        return direct_create_ref_use_is_safe(create_ref_root, render_function, ctx);
    };
    analyze_owned_create_ref_value(&owned_value, render_function, ctx, &mut Vec::new())
}

struct OwnedCreateRefValue {
    symbol_id: SymbolId,
    property_path: Vec<String>,
}

fn find_owned_create_ref_value<'a, 'b>(
    create_ref_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<OwnedCreateRefValue> {
    let mut current = transparent_expression_root(create_ref_node, ctx);
    let mut reverse_property_path = Vec::new();
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ObjectProperty(property) if property.value.span() == current.span() => {
                reverse_property_path.push(property.key.static_name()?.to_string());
                let object_node = ctx.nodes().parent_node(parent.id());
                if !matches!(object_node.kind(), AstKind::ObjectExpression(_)) {
                    return None;
                }
                current = transparent_expression_root(object_node, ctx);
            }
            AstKind::ArrayExpression(array) => {
                let element_index = array.elements.iter().position(|element| {
                    element
                        .as_expression()
                        .is_some_and(|expression| expression.span() == current.span())
                })?;
                reverse_property_path.push(element_index.to_string());
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == current.span()) =>
            {
                let binding = declarator.id.get_binding_identifier()?;
                reverse_property_path.reverse();
                return Some(OwnedCreateRefValue {
                    symbol_id: binding.symbol_id(),
                    property_path: reverse_property_path,
                });
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign
                    && assignment.right.span() == current.span() =>
            {
                let assigned_member = assignment.left.as_member_expression()?;
                reverse_property_path.push(assigned_member.static_property_name()?.to_string());
                let Expression::Identifier(receiver) =
                    assigned_member.object().get_inner_expression()
                else {
                    return None;
                };
                let symbol_id = ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()?;
                reverse_property_path.reverse();
                return Some(OwnedCreateRefValue {
                    symbol_id,
                    property_path: reverse_property_path,
                });
            }
            _ => return None,
        }
    }
}

fn analyze_owned_create_ref_value<'a>(
    owned_value: &OwnedCreateRefValue,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbols.contains(&owned_value.symbol_id) {
        return false;
    }
    visited_symbols.push(owned_value.symbol_id);
    let result = ctx
        .scoping()
        .get_resolved_references(owned_value.symbol_id)
        .all(|reference| {
            if reference.is_write() {
                return false;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if safe_create_ref_callback_current_write(
                reference_node,
                &owned_value.property_path,
                render_function,
                ctx,
            ) {
                return true;
            }
            let Some(reference_render_function) =
                create_ref_reference_render_function(reference_node, render_function, ctx)
            else {
                return false;
            };
            let Some((member_root, reference_path)) =
                collect_static_member_access(reference_node, ctx)
            else {
                return false;
            };
            if !property_paths_overlap(&reference_path, &owned_value.property_path) {
                return true;
            }
            if property_path_starts_with(&reference_path, &owned_value.property_path) {
                if reference_path.len() > owned_value.property_path.len() {
                    return reference_path.len() == owned_value.property_path.len() + 1
                        && reference_path
                            .last()
                            .is_some_and(|property| property == "current")
                        && discarded_value_node(member_root, ctx);
                }
                return create_ref_value_node_is_safe(
                    member_root,
                    reference_render_function,
                    ctx,
                    visited_symbols,
                );
            }
            analyze_partial_create_ref_value_use(
                member_root,
                &owned_value.property_path[reference_path.len()..],
                reference_render_function,
                ctx,
                visited_symbols,
            )
        });
    visited_symbols.pop();
    result
}

fn safe_create_ref_callback_current_write<'a>(
    reference_node: &AstNode<'a>,
    owned_property_path: &[String],
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((member_root, reference_path)) = collect_static_member_access(reference_node, ctx)
    else {
        return false;
    };
    if reference_path.len() != owned_property_path.len() + 1
        || !property_path_starts_with(&reference_path, owned_property_path)
        || reference_path
            .last()
            .is_none_or(|property| property != "current")
    {
        return false;
    }
    let assignment_node = ctx.nodes().parent_node(member_root.id());
    if !matches!(
        assignment_node.kind(),
        AstKind::AssignmentExpression(assignment)
            if assignment.operator == AssignmentOperator::Assign
                && assignment.left.span() == member_root.span()
    ) {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(reference_node.id()) {
        if ancestor.id() == render_function.id() {
            break;
        }
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let function_root = transparent_expression_root(ancestor, ctx);
        let container = ctx.nodes().parent_node(function_root.id());
        let AstKind::JSXExpressionContainer(_) = container.kind() else {
            continue;
        };
        let attribute_node = ctx.nodes().parent_node(container.id());
        let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
            continue;
        };
        if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "ref")
        {
            continue;
        }
        let opening_node = ctx.nodes().parent_node(attribute_node.id());
        let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
            continue;
        };
        if !jsx_element_is_direct_ref_sink(opening_element, ctx) {
            return false;
        }
        let element_node = ctx.nodes().parent_node(opening_node.id());
        return jsx_value_reaches_render(element_node, render_function, ctx);
    }
    false
}

fn create_ref_reference_render_function<'a, 'b>(
    reference_node: &'b AstNode<'a>,
    owner_function: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let reference_function = crate::ast_util::get_enclosing_function(reference_node, ctx)?;
    if reference_function.id() == owner_function.id() {
        return Some(owner_function);
    }
    create_ref_local_function_is_render_only(reference_function, owner_function, ctx)
        .then_some(reference_function)
}

fn create_ref_local_function_is_render_only<'a>(
    function_node: &AstNode<'a>,
    owner_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !create_ref_function_is_synchronous(function_node)
        || crate::ast_util::get_enclosing_function(function_node, ctx)
            .is_none_or(|function| function.id() != owner_function.id())
    {
        return false;
    }
    let Some(symbol_id) = function_binding_symbol(function_node, ctx) else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|reference| {
            !reference.is_write() && {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let call_node = ctx.nodes().parent_node(reference_root.id());
                matches!(
                    call_node.kind(),
                    AstKind::CallExpression(call_expression)
                        if call_expression.callee.span() == reference_root.span()
                            && crate::ast_util::get_enclosing_function(call_node, ctx)
                                .is_some_and(|function| function.id() == owner_function.id())
                            && jsx_value_reaches_render(call_node, owner_function, ctx)
                )
            }
        })
}

fn property_path_starts_with(property_path: &[String], prefix: &[String]) -> bool {
    prefix
        .iter()
        .enumerate()
        .all(|(index, property)| property_path.get(index) == Some(property))
}

fn property_paths_overlap(first: &[String], second: &[String]) -> bool {
    property_path_starts_with(first, second) || property_path_starts_with(second, first)
}

fn collect_static_member_access<'a, 'b>(
    identifier_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, Vec<String>)> {
    let mut current = transparent_expression_root(identifier_node, ctx);
    let mut property_path = Vec::new();
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let property_name = match parent.kind() {
            AstKind::StaticMemberExpression(member) if member.object.span() == current.span() => {
                Some(member.property.name.to_string())
            }
            AstKind::ComputedMemberExpression(member) if member.object.span() == current.span() => {
                member.static_property_name().map(|name| name.to_string())
            }
            _ => None,
        };
        let Some(property_name) = property_name else {
            break;
        };
        property_path.push(property_name);
        current = transparent_expression_root(parent, ctx);
    }
    Some((current, property_path))
}

fn discarded_value_node<'a, 'b>(node: &'b AstNode<'a>, ctx: &'b LintContext<'a>) -> bool {
    let node_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(node_root.id());
    matches!(parent.kind(), AstKind::ExpressionStatement(_))
        || matches!(
            parent.kind(),
            AstKind::UnaryExpression(unary)
                if unary.operator == UnaryOperator::Void
                    && unary.argument.span() == node_root.span()
        )
}

fn create_ref_value_node_is_safe<'a>(
    value_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    if discarded_value_node(value_node, ctx)
        || value_is_direct_intrinsic_ref_sink(value_node, render_function, ctx)
        || value_is_intrinsic_spread_ref_sink(value_node, &[], render_function, ctx)
    {
        return true;
    }
    let value_root = transparent_expression_root(value_node, ctx);
    let parent = ctx.nodes().parent_node(value_root.id());
    if let AstKind::CallExpression(call_expression) = parent.kind()
        && create_ref_expression_is_argument_at(&call_expression.arguments, 0, value_root.span())
        && call_expression.callee_name() == Some("Boolean")
    {
        let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
            return false;
        };
        return ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none();
    }
    if let AstKind::CallExpression(call_expression) = parent.kind()
        && let Some(argument_index) = call_expression.arguments.iter().position(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == value_root.span())
        })
        && let Some((callee_function, parameter_symbol_id)) =
            create_ref_local_call_parameter(call_expression, argument_index, ctx)
        && create_ref_function_is_synchronous(callee_function)
        && function_contains_react_render_output(callee_function, ctx)
        && jsx_value_reaches_render(parent, render_function, ctx)
    {
        return analyze_owned_create_ref_value(
            &OwnedCreateRefValue {
                symbol_id: parameter_symbol_id,
                property_path: Vec::new(),
            },
            callee_function,
            ctx,
            visited_symbols,
        );
    }
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == value_root.span())
        && let Some(binding) = declarator.id.get_binding_identifier()
    {
        return analyze_owned_create_ref_value(
            &OwnedCreateRefValue {
                symbol_id: binding.symbol_id(),
                property_path: Vec::new(),
            },
            render_function,
            ctx,
            visited_symbols,
        );
    }
    create_ref_reference_is_safe(value_node, render_function, ctx)
}

fn create_ref_local_call_parameter<'a, 'b>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    argument_index: usize,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, SymbolId)> {
    let callee_function = match call_expression.callee.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            ctx.nodes().get_node(function.node_id.get())
        }
        Expression::FunctionExpression(function) => ctx.nodes().get_node(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            create_ref_local_function_for_symbol(symbol_id, ctx)?
        }
        _ => return None,
    };
    let parameters = match callee_function.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let parameter = parameters.items.get(argument_index)?;
    Some((
        callee_function,
        parameter.pattern.get_binding_identifier()?.symbol_id(),
    ))
}

fn create_ref_function_is_synchronous(function_node: &AstNode<'_>) -> bool {
    match function_node.kind() {
        AstKind::Function(function) => !function.r#async && !function.generator,
        AstKind::ArrowFunctionExpression(function) => !function.r#async,
        _ => false,
    }
}

fn analyze_partial_create_ref_value_use<'a>(
    value_node: &AstNode<'a>,
    remaining_path: &[String],
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    let value_root = transparent_expression_root(value_node, ctx);
    if value_is_intrinsic_spread_ref_sink(value_root, remaining_path, render_function, ctx) {
        return true;
    }
    let container = ctx.nodes().parent_node(value_root.id());
    let AstKind::JSXExpressionContainer(_) = container.kind() else {
        return false;
    };
    let attribute_node = ctx.nodes().parent_node(container.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return false;
    };
    let opening_node = ctx.nodes().parent_node(attribute_node.id());
    let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
        return false;
    };
    let oxc_ast::ast::JSXElementName::IdentifierReference(component_identifier) =
        &opening_element.name
    else {
        return false;
    };
    let Some(component_symbol_id) = ctx
        .scoping()
        .get_reference(component_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(component_function) = create_ref_local_function_for_symbol(component_symbol_id, ctx)
    else {
        return false;
    };
    let Some(parameter_symbol_id) = create_ref_component_property_parameter_symbol(
        component_function,
        attribute_name.name.as_str(),
    ) else {
        return false;
    };
    analyze_owned_create_ref_value(
        &OwnedCreateRefValue {
            symbol_id: parameter_symbol_id,
            property_path: remaining_path.to_vec(),
        },
        render_function,
        ctx,
        visited_symbols,
    )
}

fn value_is_intrinsic_spread_ref_sink<'a>(
    value_node: &AstNode<'a>,
    remaining_path: &[String],
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut spread_value = transparent_expression_root(value_node, ctx);
    if remaining_path.is_empty() {
        let property_node = ctx.nodes().parent_node(spread_value.id());
        let AstKind::ObjectProperty(property) = property_node.kind() else {
            return false;
        };
        if property.value.span() != spread_value.span()
            || property.key.static_name().as_deref() != Some("ref")
        {
            return false;
        }
        let object_node = ctx.nodes().parent_node(property_node.id());
        if !matches!(object_node.kind(), AstKind::ObjectExpression(_)) {
            return false;
        }
        spread_value = transparent_expression_root(object_node, ctx);
    } else if remaining_path.len() != 1 || remaining_path[0] != "ref" {
        return false;
    }
    let spread_node = ctx.nodes().parent_node(spread_value.id());
    let AstKind::JSXSpreadAttribute(spread_attribute) = spread_node.kind() else {
        return false;
    };
    if spread_attribute.argument.span() != spread_value.span() {
        return false;
    }
    let opening_node = ctx.nodes().parent_node(spread_node.id());
    let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
        return false;
    };
    if !jsx_element_is_direct_ref_sink(opening_element, ctx) {
        return false;
    }
    let element_node = ctx.nodes().parent_node(opening_node.id());
    jsx_value_reaches_render(element_node, render_function, ctx)
}

fn create_ref_local_function_for_symbol<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(ctx.nodes().get_node(function.node_id.get())),
        AstKind::VariableDeclarator(declarator) => match declarator.init.as_ref()? {
            Expression::ArrowFunctionExpression(function) => {
                Some(ctx.nodes().get_node(function.node_id.get()))
            }
            Expression::FunctionExpression(function) => {
                Some(ctx.nodes().get_node(function.node_id.get()))
            }
            _ => None,
        },
        _ => None,
    }
}

fn create_ref_component_property_parameter_symbol(
    function_node: &AstNode<'_>,
    property_name: &str,
) -> Option<SymbolId> {
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let first_parameter = parameters.items.first()?;
    let oxc_ast::ast::BindingPattern::ObjectPattern(object_pattern) = &first_parameter.pattern
    else {
        return None;
    };
    object_pattern.properties.iter().find_map(|property| {
        (property.key.static_name().as_deref() == Some(property_name))
            .then(|| {
                property
                    .value
                    .get_binding_identifier()
                    .map(|binding| binding.symbol_id())
            })
            .flatten()
    })
}

fn direct_create_ref_use_is_safe<'a>(
    create_ref_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(create_ref_node.id());
    matches!(parent.kind(), AstKind::ExpressionStatement(_))
        || matches!(parent.kind(), AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Void)
        || value_is_direct_intrinsic_ref_sink(create_ref_node, render_function, ctx)
}

fn create_ref_reference_is_safe<'a>(
    reference_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    if matches!(parent.kind(), AstKind::ExpressionStatement(_))
        || matches!(parent.kind(), AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Void)
        || value_is_direct_intrinsic_ref_sink(expression_root, render_function, ctx)
    {
        return true;
    }
    if matches!(
        parent.kind(),
        AstKind::StaticMemberExpression(member_expression)
            if member_expression.object.span() == expression_root.span()
                && member_expression.property.name == "current"
    ) {
        let member_root = transparent_expression_root(parent, ctx);
        let member_parent = ctx.nodes().parent_node(member_root.id());
        return matches!(
            member_parent.kind(),
            AstKind::UnaryExpression(unary)
                if unary.operator == UnaryOperator::Void
                    && unary.argument.span() == member_root.span()
        );
    }
    if let AstKind::CallExpression(call_expression) = parent.kind()
        && create_ref_expression_is_argument_at(
            &call_expression.arguments,
            0,
            expression_root.span(),
        )
        && matches!(call_expression.callee_name(), Some("Boolean"))
    {
        let Expression::Identifier(callee) = call_expression.callee.get_inner_expression() else {
            return false;
        };
        return ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none();
    }
    if let AstKind::BinaryExpression(binary) = parent.kind()
        && matches!(
            binary.operator,
            BinaryOperator::Equality
                | BinaryOperator::Inequality
                | BinaryOperator::StrictEquality
                | BinaryOperator::StrictInequality
        )
    {
        let other = if binary.left.span() == expression_root.span() {
            &binary.right
        } else {
            &binary.left
        };
        let AstKind::IdentifierReference(reference_identifier) = reference_node.kind() else {
            return false;
        };
        let Expression::Identifier(other_identifier) = other.get_inner_expression() else {
            return false;
        };
        return ctx
            .scoping()
            .get_reference(reference_identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                ctx.scoping()
                    .get_reference(other_identifier.reference_id())
                    .symbol_id()
                    == Some(symbol_id)
            });
    }
    false
}

fn value_is_direct_intrinsic_ref_sink<'a>(
    value_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let container = ctx.nodes().parent_node(value_node.id());
    let AstKind::JSXExpressionContainer(_) = container.kind() else {
        return react_create_element_ref_is_rendered(value_node, render_function, ctx);
    };
    let attribute_node = ctx.nodes().parent_node(container.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "ref")
    {
        return false;
    }
    let opening_node = ctx.nodes().parent_node(attribute_node.id());
    let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
        return false;
    };
    if !jsx_element_is_direct_ref_sink(opening_element, ctx) {
        return false;
    }
    let element_node = ctx.nodes().parent_node(opening_node.id());
    jsx_value_reaches_render(element_node, render_function, ctx)
}

fn jsx_element_is_direct_ref_sink<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_proven_intrinsic_jsx_element(opening_element, ctx) {
        return true;
    }
    let oxc_ast::ast::JSXElementName::IdentifierReference(identifier) = &opening_element.name
    else {
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
    match declaration.kind() {
        AstKind::Class(class) => class.heritage.as_ref().is_some_and(|heritage| {
            react_class_base_expression(&heritage.expression, ctx, &mut Vec::new())
        }),
        AstKind::VariableDeclarator(declarator) => matches!(
            declarator.init.as_ref(),
            Some(Expression::ClassExpression(class))
                if class.heritage.as_ref().is_some_and(|heritage| {
                    react_class_base_expression(&heritage.expression, ctx, &mut Vec::new())
                })
        ),
        _ => false,
    }
}

fn react_class_base_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    if imported_module_api_matches(expression, "Component", "react", ctx)
        || imported_module_api_matches(expression, "PureComponent", "react", ctx)
    {
        return true;
    }
    if let Some(member) = expression.get_inner_expression().as_member_expression()
        && matches!(
            member.static_property_name(),
            Some("Component" | "PureComponent")
        )
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "React"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbols.contains(&symbol_id) {
        return false;
    }
    visited_symbols.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let result = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
    if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
        && declarator.init.as_ref().is_some_and(|initializer| {
            react_class_base_expression(initializer, ctx, visited_symbols)
        }));
    visited_symbols.pop();
    result
}

fn react_create_element_ref_is_rendered<'a>(
    value_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = value_node;
    let property_node = ctx.nodes().parent_node(current.id());
    let AstKind::ObjectProperty(property) = property_node.kind() else {
        return false;
    };
    if property.value.span() != current.span()
        || property.key.static_name().as_deref() != Some("ref")
    {
        return false;
    }
    let object_node = ctx.nodes().parent_node(property_node.id());
    if !matches!(object_node.kind(), AstKind::ObjectExpression(_)) {
        return false;
    }
    current = transparent_expression_root(object_node, ctx);
    let call_node = ctx.nodes().parent_node(current.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    if !create_ref_expression_is_argument_at(&call_expression.arguments, 1, current.span())
        || !is_react_api_call(call_expression, "createElement", ctx)
        || !matches!(
            call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::StringLiteral(_))
        )
    {
        return false;
    }
    jsx_value_reaches_render(call_node, render_function, ctx)
}

fn jsx_value_reaches_render<'a>(
    value_node: &AstNode<'a>,
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(value_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == render_function.id() {
            return matches!(
                render_function.kind(),
                AstKind::ArrowFunctionExpression(function)
                    if function
                        .get_expression()
                        .is_some_and(|expression| expression.span() == current.span())
            );
        }
        match parent.kind() {
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                return crate::ast_util::get_enclosing_function(parent, ctx)
                    .is_some_and(|function| function.id() == render_function.id());
            }
            AstKind::JSXExpressionContainer(_)
            | AstKind::JSXElement(_)
            | AstKind::JSXFragment(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_) => current = parent,
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == current.span()) =>
            {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    return false;
                };
                return ctx
                    .scoping()
                    .get_resolved_references(binding.symbol_id())
                    .all(|reference| {
                        let reference_node = ctx.nodes().get_node(reference.node_id());
                        jsx_value_reaches_render(reference_node, render_function, ctx)
                    });
            }
            _ => return false,
        }
    }
}
