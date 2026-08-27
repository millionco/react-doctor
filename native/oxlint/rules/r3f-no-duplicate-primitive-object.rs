use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeValue, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;

const DUPLICATE_MESSAGE: &str = "The same Three.js object is mounted by more than one <primitive> in this render tree. Use one owner or clone it into independent instances";
const REPEATED_MAP_MESSAGE: &str = "The same Three.js object is mounted repeatedly by this map. Clone it into an independent instance for each mount";

struct PrimitiveMountGroup {
    mount_site_ids: Vec<oxc_semantic::NodeId>,
    object_key: String,
    owner_id: oxc_semantic::NodeId,
}

struct PrimitiveMountGuard {
    is_negated: bool,
    symbol_id: oxc_semantic::SymbolId,
}

#[derive(Debug, Default, Clone)]
pub struct R3FNoDuplicatePrimitiveObject;

impl RuleMeta for R3FNoDuplicatePrimitiveObject {
    const NAME: &'static str = "r3f-no-duplicate-primitive-object";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow mounting one Three.js object through multiple primitives.",
    };
}

impl Rule for R3FNoDuplicatePrimitiveObject {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let mut mount_groups: Vec<PrimitiveMountGroup> = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                opening_element.name.get_identifier_name(),
                Some(name) if name == "primitive"
            ) {
                continue;
            }
            let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "object", true)
            else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(object_expression) = container.expression.as_expression() else {
                continue;
            };
            let object_expression = object_expression.get_inner_expression();
            if !matches!(
                object_expression,
                Expression::Identifier(_)
                    | Expression::ComputedMemberExpression(_)
                    | Expression::StaticMemberExpression(_)
                    | Expression::PrivateFieldExpression(_)
            ) {
                continue;
            }
            let Some(object_key) =
                primitive_object_expression_key(object_expression, ctx, &mut Vec::new())
            else {
                continue;
            };
            if primitive_is_inside_repeated_map(node, object_expression, ctx) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(REPEATED_MAP_MESSAGE).with_label(object_expression.span()),
                );
                continue;
            }
            let Some(owner) = primitive_mounting_render_owner(node, ctx) else {
                continue;
            };
            let mount_site_ids = primitive_mount_site_ids(node, owner, ctx);
            let group = mount_groups
                .iter_mut()
                .find(|group| group.owner_id == owner.id() && group.object_key == object_key);
            let Some(group) = group else {
                mount_groups.push(PrimitiveMountGroup {
                    mount_site_ids,
                    object_key,
                    owner_id: owner.id(),
                });
                continue;
            };
            let can_duplicate = group.mount_site_ids.iter().any(|previous_site_id| {
                let previous_site = ctx.nodes().get_node(*previous_site_id);
                mount_site_ids.iter().any(|mount_site_id| {
                    primitive_mounts_can_coexist(
                        previous_site,
                        ctx.nodes().get_node(*mount_site_id),
                        ctx,
                    )
                })
            });
            group.mount_site_ids.extend(mount_site_ids);
            if can_duplicate {
                ctx.diagnostic(
                    OxcDiagnostic::warn(DUPLICATE_MESSAGE).with_label(object_expression.span()),
                );
            }
        }
    }
}

fn primitive_object_expression_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return Some(format!("global:{}", identifier.name));
        };
        let symbol_key = format!("symbol:{symbol_id:?}");
        if visited_symbol_ids.contains(&symbol_id) {
            return Some(symbol_key);
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_key);
        };
        if let BindingPattern::ObjectPattern(pattern) = &declarator.id
            && let Some(property_name) = pattern.properties.iter().find_map(|property| {
                matches!(
                    &property.value,
                    BindingPattern::BindingIdentifier(identifier)
                        if identifier.symbol_id() == symbol_id
                )
                .then(|| property.key.static_name())
                .flatten()
                .filter(|name| !name.is_empty())
            })
            && let Some(initializer) = &declarator.init
            && let Some(object_key) =
                primitive_object_expression_key(initializer, ctx, visited_symbol_ids)
        {
            return Some(format!("{object_key}.{property_name}"));
        }
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(
            parent.kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return Some(symbol_key);
        }
        let initializer = declarator.init.as_ref()?.get_inner_expression();
        if matches!(
            initializer,
            Expression::Identifier(_)
                | Expression::ComputedMemberExpression(_)
                | Expression::StaticMemberExpression(_)
                | Expression::PrivateFieldExpression(_)
        ) {
            return primitive_object_expression_key(initializer, ctx, visited_symbol_ids)
                .or(Some(symbol_key));
        }
        return Some(symbol_key);
    }
    if let Some(member_expression) = expression.as_member_expression() {
        let property_name = primitive_member_property_name(member_expression)?;
        if property_name.is_empty() {
            return None;
        }
        let object_key =
            primitive_object_expression_key(member_expression.object(), ctx, visited_symbol_ids)?;
        return Some(format!("{object_key}.{property_name}"));
    }
    match expression {
        Expression::ThisExpression(_) => Some("this".to_string()),
        Expression::StringLiteral(literal) => Some(format!("literal:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!(
            "literal:{}",
            format_javascript_number(literal.value)
        )),
        _ => None,
    }
}

fn primitive_member_property_name(member_expression: &MemberExpression<'_>) -> Option<String> {
    if let Some(property_name) = member_expression.static_property_name() {
        return Some(property_name.to_string());
    }
    let MemberExpression::ComputedMemberExpression(member_expression) = member_expression else {
        return None;
    };
    let Expression::NumericLiteral(literal) = member_expression.expression.get_inner_expression()
    else {
        return None;
    };
    Some(format_javascript_number(literal.value))
}

fn primitive_mounting_render_owner<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let nearest_function = crate::ast_util::get_enclosing_function(node, ctx)?;
    let Some(render_owner) = primitive_render_owner(nearest_function, ctx) else {
        return Some(nearest_function);
    };
    if nearest_function.id() == render_owner.id() {
        return Some(nearest_function);
    }
    let mut current_function = nearest_function;
    while current_function.id() != render_owner.id() {
        let Some(next_function) = ctx
            .nodes()
            .ancestors(current_function.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
        else {
            return Some(nearest_function);
        };
        let function_root = transparent_expression_root(current_function, ctx);
        let call_node = ctx.nodes().parent_node(function_root.id());
        if !matches!(call_node.kind(), AstKind::CallExpression(_)) {
            return Some(nearest_function);
        }
        if ctx
            .nodes()
            .ancestors(call_node.id())
            .take_while(|ancestor| ancestor.id() != next_function.id())
            .any(|ancestor| matches!(ancestor.kind(), AstKind::JSXExpressionContainer(_)))
        {
            return Some(render_owner);
        }
        if !primitive_node_reaches_function_return(call_node, next_function, ctx, &mut Vec::new()) {
            return Some(nearest_function);
        }
        current_function = next_function;
    }
    Some(render_owner)
}

fn primitive_render_owner<'a, 'b>(
    mut function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    loop {
        if component_or_hook_function_name(function_node, ctx).is_some() {
            return Some(function_node);
        }
        if !function_executes_during_render(function_node, ctx) {
            return None;
        }
        function_node = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })?;
    }
}

fn primitive_mount_site_ids(
    opening_node: &AstNode<'_>,
    owner: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Vec<oxc_semantic::NodeId> {
    let element_node = ctx.nodes().parent_node(opening_node.id());
    if !matches!(element_node.kind(), AstKind::JSXElement(_)) {
        return vec![opening_node.id()];
    }
    let element_root = transparent_expression_root(element_node, ctx);
    let declarator_node = ctx.nodes().parent_node(element_root.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return vec![opening_node.id()];
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != element_root.span())
    {
        return vec![opening_node.id()];
    }
    let Some(identifier) = declarator.id.get_binding_identifier() else {
        return vec![opening_node.id()];
    };
    let references: Vec<_> = ctx
        .scoping()
        .get_resolved_references(identifier.symbol_id())
        .filter(|reference| !reference.is_write())
        .collect();
    if references.is_empty() {
        return Vec::new();
    }
    let rendered_reference_ids: Vec<_> = references
        .iter()
        .filter_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            primitive_node_reaches_function_return(reference_node, owner, ctx, &mut Vec::new())
                .then_some(reference.node_id())
        })
        .collect();
    if rendered_reference_ids.is_empty() {
        vec![opening_node.id()]
    } else {
        rendered_reference_ids
    }
}

fn primitive_node_reaches_function_return(
    node: &AstNode<'_>,
    owner: &AstNode<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == owner.id() {
            return matches!(
                owner.kind(),
                AstKind::ArrowFunctionExpression(function)
                    if function
                        .get_expression()
                        .is_some_and(|expression| expression.span().contains_inclusive(child_span))
            );
        }
        match ancestor.kind() {
            AstKind::ReturnStatement(return_statement)
                if return_statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span().contains_inclusive(child_span)) =>
            {
                return true;
            }
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    initializer.span().contains_inclusive(child_span)
                }) =>
            {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    return false;
                };
                return primitive_symbol_reaches_function_return(
                    identifier.symbol_id(),
                    ancestor.span().start,
                    owner,
                    ctx,
                    visited_symbol_ids,
                );
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.right.span().contains_inclusive(child_span) =>
            {
                let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                    &assignment.left
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
                return primitive_symbol_reaches_function_return(
                    symbol_id,
                    ancestor.span().start,
                    owner,
                    ctx,
                    visited_symbol_ids,
                );
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn primitive_symbol_reaches_function_return(
    symbol_id: oxc_semantic::SymbolId,
    assignment_start: u32,
    owner: &AstNode<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .map(|reference| ctx.nodes().get_node(reference.node_id()))
        .filter(|reference_node| reference_node.span().start > assignment_start)
        .any(|reference_node| {
            primitive_node_reaches_function_return(
                reference_node,
                owner,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        })
}

fn primitive_is_inside_repeated_map<'a>(
    node: &AstNode<'a>,
    object_expression: &Expression<'_>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    let render_owner = primitive_render_owner(enclosing_function, ctx);
    let mut current_function = Some(enclosing_function);
    while let Some(function_node) = current_function {
        if render_owner.is_some_and(|owner| owner.id() == function_node.id()) {
            break;
        }
        let root_symbol_is_local =
            primitive_root_identifier(object_expression).is_some_and(|identifier| {
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| {
                        function_node
                            .span()
                            .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
                    })
            });
        if !root_symbol_is_local
            && !is_node_conditionally_executed(node, function_node.id(), ctx)
            && primitive_function_returns_node_on_every_path(function_node, node, ctx)
            && primitive_function_has_repeated_map_call(function_node, ctx)
        {
            return true;
        }
        current_function = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        });
    }
    false
}

fn primitive_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut expression = expression.get_inner_expression();
    loop {
        if let Expression::Identifier(identifier) = expression {
            return Some(identifier);
        }
        expression = expression
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
}

fn primitive_function_returns_node_on_every_path(
    function_node: &AstNode<'_>,
    target_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let target_span = target_node.span();
    if matches!(
        function_node.kind(),
        AstKind::ArrowFunctionExpression(function)
            if function
                .get_expression()
                .is_some_and(|expression| expression.span().contains_inclusive(target_span))
    ) {
        return true;
    }
    let body = match function_node.kind() {
        AstKind::Function(function) => function.body.as_deref(),
        AstKind::ArrowFunctionExpression(function) => function.body.as_function_body(),
        _ => None,
    };
    let body_has_exit = body.is_some_and(|body| {
        body.statements
            .iter()
            .any(|statement| statement_always_exits(statement))
    });
    if !body_has_exit {
        return false;
    }
    let returns: Vec<_> = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            function_node.span().contains_inclusive(candidate.span())
                && matches!(candidate.kind(), AstKind::ReturnStatement(_))
                && crate::ast_util::get_enclosing_function(candidate, ctx)
                    .is_some_and(|owner| owner.id() == function_node.id())
        })
        .collect();
    !returns.is_empty()
        && returns.iter().all(|return_node| {
            matches!(
                return_node.kind(),
                AstKind::ReturnStatement(return_statement)
                    if return_statement.argument.as_ref().is_some_and(|argument| {
                        argument.span().contains_inclusive(target_span)
                    })
            )
        })
}

fn primitive_function_has_repeated_map_call<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let function_root = transparent_expression_root(function_node, ctx);
    let direct_parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::CallExpression(call_expression) = direct_parent.kind()
        && primitive_expression_is_first_argument(call_expression, function_root.span())
        && primitive_is_repeated_map_call(call_expression)
        && primitive_call_executes_during_render(direct_parent, ctx)
    {
        return true;
    }
    let Some(symbol_id) = primitive_callback_symbol_id(function_node, function_root, ctx) else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .map(|reference| ctx.nodes().get_node(reference.node_id()))
        .any(|reference_node| {
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            matches!(
                parent.kind(),
                AstKind::CallExpression(call_expression)
                    if primitive_expression_is_first_argument(call_expression, reference_root.span())
                        && primitive_is_repeated_map_call(call_expression)
                        && primitive_call_executes_during_render(parent, ctx)
            )
        })
}

fn primitive_call_executes_during_render<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    crate::ast_util::get_enclosing_function(call_node, ctx)
        .is_some_and(|function_node| primitive_render_owner(function_node, ctx).is_some())
}

fn primitive_callback_symbol_id(
    function_node: &AstNode<'_>,
    function_root: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let declaration = ctx.nodes().parent_node(function_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != function_root.span())
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        )
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn primitive_expression_is_first_argument(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    expression_span: oxc_span::Span,
) -> bool {
    call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|expression| expression.span() == expression_span)
}

fn primitive_is_repeated_map_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    let MemberExpression::StaticMemberExpression(member_expression) = member_expression else {
        return false;
    };
    let Expression::ArrayExpression(array_expression) =
        member_expression.object.get_inner_expression()
    else {
        return false;
    };
    member_expression.property.name == "map"
        && array_expression.elements.len() >= 2
        && array_expression
            .elements
            .iter()
            .all(|element| element.as_expression().is_some())
}

fn primitive_mounts_can_coexist<'a>(
    first: &AstNode<'a>,
    second: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let first_return = primitive_enclosing_return(first, ctx);
    let second_return = primitive_enclosing_return(second, ctx);
    if let (Some(first_return), Some(second_return)) = (first_return, second_return)
        && first_return.id() != second_return.id()
        && crate::ast_util::get_enclosing_function(first_return, ctx).map(AstNode::id)
            == crate::ast_util::get_enclosing_function(second_return, ctx).map(AstNode::id)
    {
        return false;
    }
    let first_guards = primitive_mount_guards(first, ctx);
    let second_guards = primitive_mount_guards(second, ctx);
    if first_guards.iter().any(|first_guard| {
        second_guards.iter().any(|second_guard| {
            first_guard.symbol_id == second_guard.symbol_id
                && first_guard.is_negated != second_guard.is_negated
        })
    }) {
        return false;
    }
    let second_span = second.span();
    for ancestor in ctx.nodes().ancestors(first.id()) {
        match ancestor.kind() {
            AstKind::ConditionalExpression(expression)
                if (expression
                    .consequent
                    .span()
                    .contains_inclusive(first.span())
                    && expression.alternate.span().contains_inclusive(second_span))
                    || (expression.alternate.span().contains_inclusive(first.span())
                        && expression.consequent.span().contains_inclusive(second_span)) =>
            {
                return false;
            }
            AstKind::IfStatement(statement)
                if statement.alternate.as_ref().is_some_and(|alternate| {
                    (statement.consequent.span().contains_inclusive(first.span())
                        && alternate.span().contains_inclusive(second_span))
                        || (alternate.span().contains_inclusive(first.span())
                            && statement.consequent.span().contains_inclusive(second_span))
                }) =>
            {
                return false;
            }
            _ => {}
        }
    }
    true
}

fn primitive_enclosing_return<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
}

fn primitive_mount_guards(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Vec<PrimitiveMountGuard> {
    let mut guards = Vec::new();
    let node_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let guarded_expression = match ancestor.kind() {
            AstKind::LogicalExpression(expression)
                if matches!(
                    expression.operator,
                    oxc_syntax::operator::LogicalOperator::And
                        | oxc_syntax::operator::LogicalOperator::Or
                ) && expression.right.span().contains_inclusive(node_span) =>
            {
                Some((
                    &expression.left,
                    expression.operator == oxc_syntax::operator::LogicalOperator::Or,
                ))
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span().contains_inclusive(node_span) =>
            {
                Some((&expression.test, false))
            }
            AstKind::ConditionalExpression(expression)
                if expression.alternate.span().contains_inclusive(node_span) =>
            {
                Some((&expression.test, true))
            }
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(node_span) =>
            {
                Some((&statement.test, false))
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(node_span)) =>
            {
                Some((&statement.test, true))
            }
            _ => None,
        };
        if let Some((expression, is_negated)) = guarded_expression
            && let Some(guard) = primitive_read_mount_guard(expression, is_negated, ctx)
        {
            guards.push(guard);
        }
    }
    guards
}

fn primitive_read_mount_guard(
    expression: &Expression<'_>,
    is_negated: bool,
    ctx: &LintContext<'_>,
) -> Option<PrimitiveMountGuard> {
    let expression = expression.get_inner_expression();
    if let Expression::UnaryExpression(unary_expression) = expression
        && unary_expression.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
    {
        return primitive_read_mount_guard(&unary_expression.argument, !is_negated, ctx);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    Some(PrimitiveMountGuard {
        is_negated,
        symbol_id,
    })
}
