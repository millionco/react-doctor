use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentTarget, Expression, MemberExpression, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::Span;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const REF_RENDER_MESSAGE: &str = "This ref is mutated during render. React can replay or discard render work, so the mutation can leak from UI that never commits.";
const REF_RENDER_NON_DETERMINISTIC_BARE_CALLS: [&str; 5] =
    ["nanoid", "uuid", "cuid", "ulid", "createId"];
const REF_RENDER_NON_DETERMINISTIC_MEMBER_CALLS: [(&str, &str); 5] = [
    ("Math", "random"),
    ("Date", "now"),
    ("performance", "now"),
    ("crypto", "randomUUID"),
    ("crypto", "getRandomValues"),
];

#[derive(Debug, Default, Clone)]
pub struct NoRefCurrentInRender;

declare_oxc_lint!(
    /// Disallow ref mutations during render except predictable lazy initialization.
    NoRefCurrentInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Ref mutated during render.",
);

impl Rule for NoRefCurrentInRender {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    let Some(ref_symbol_id) =
                        ref_render_assignment_target_symbol(&assignment.left, ctx)
                    else {
                        continue;
                    };
                    if ref_render_is_documented_lazy_initialization(
                        node,
                        assignment,
                        ref_symbol_id,
                        ctx,
                    ) {
                        continue;
                    }
                    ref_render_report_if_render_phase(node, assignment.left.span(), ctx);
                }
                AstKind::UpdateExpression(update) => {
                    if update
                        .argument
                        .as_member_expression()
                        .and_then(|member| ref_render_member_chain_symbol(member, ctx))
                        .is_some()
                    {
                        ref_render_report_if_render_phase(node, update.argument.span(), ctx);
                    }
                }
                _ => {}
            }
        }
    }
}

fn ref_render_report_if_render_phase<'a>(node: &AstNode<'a>, span: Span, ctx: &LintContext<'a>) {
    if find_render_phase_component_or_hook(node, ctx).is_some() {
        ctx.diagnostic(OxcDiagnostic::error(REF_RENDER_MESSAGE).with_label(span));
    }
}

fn ref_render_assignment_target_symbol<'a>(
    target: &AssignmentTarget<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    ref_render_member_chain_symbol(target.as_member_expression()?, ctx)
}

fn ref_render_expression_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    ref_render_member_chain_symbol(
        expression.get_inner_expression().as_member_expression()?,
        ctx,
    )
}

fn ref_render_member_chain_symbol<'a>(
    member: &MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if member.static_property_name() != Some("current") {
        return None;
    }
    ref_render_current_object_symbol(member.object(), ctx)
}

fn ref_render_current_object_symbol<'a>(
    object: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return None;
    };
    let symbol_id = resolve_const_identifier_alias(identifier, ctx)?;
    ref_render_symbol_is_react_ref(symbol_id, ctx).then_some(symbol_id)
}

fn ref_render_symbol_is_react_ref<'a>(symbol_id: SymbolId, ctx: &LintContext<'a>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    ref_render_is_use_ref_call(call, ctx)
}

fn ref_render_is_use_ref_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .and_then(|symbol_id| matching_react_import(symbol_id, ctx))
            .is_some_and(|entry| {
                matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "useRef"
                )
            }),
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name() == Some("useRef")
                && is_react_namespace_receiver(member.object().get_inner_expression(), ctx)
        }),
    }
}

fn ref_render_is_documented_lazy_initialization<'a>(
    assignment_node: &AstNode<'a>,
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(render_owner) = find_render_phase_component_or_hook(assignment_node, ctx) else {
        return false;
    };
    match assignment.operator {
        AssignmentOperator::LogicalNullish | AssignmentOperator::LogicalOr => {
            return ref_render_is_predictable_guarded_initialization(
                assignment_node,
                assignment,
                render_owner,
                render_owner,
                ref_symbol_id,
                assignment.operator == AssignmentOperator::LogicalOr,
                ctx,
            );
        }
        AssignmentOperator::Assign => {}
        _ => return false,
    }

    let mut descendant_id = assignment_node.id();
    let mut descendant_span = assignment_node.span();
    for ancestor in ctx.nodes().ancestors(assignment_node.id()) {
        let AstKind::IfStatement(if_statement) = ancestor.kind() else {
            descendant_id = ancestor.id();
            descendant_span = ancestor.span();
            continue;
        };
        let test = if_statement.test.get_inner_expression();
        if let Expression::UnaryExpression(unary) = test
            && unary.operator == UnaryOperator::LogicalNot
            && ref_render_same_current_alias(&unary.argument, ref_symbol_id, ctx)
            && if_statement.consequent.span() == descendant_span
            && ref_render_is_predictable_guarded_initialization(
                assignment_node,
                assignment,
                ctx.nodes().get_node(descendant_id),
                render_owner,
                ref_symbol_id,
                true,
                ctx,
            )
        {
            return true;
        }
        if let Expression::BinaryExpression(binary) = test
            && matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            )
        {
            let compares_empty = (ref_render_same_current_alias(&binary.left, ref_symbol_id, ctx)
                && ref_render_is_empty_sentinel(&binary.right, ctx))
                || (ref_render_same_current_alias(&binary.right, ref_symbol_id, ctx)
                    && ref_render_is_empty_sentinel(&binary.left, ctx));
            let guarded_statement = if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            ) {
                Some(&if_statement.consequent)
            } else {
                if_statement.alternate.as_ref()
            };
            if compares_empty
                && let Some(guarded_statement) = guarded_statement
                && guarded_statement.span() == descendant_span
                && ref_render_is_predictable_guarded_initialization(
                    assignment_node,
                    assignment,
                    ctx.nodes().get_node(descendant_id),
                    render_owner,
                    ref_symbol_id,
                    false,
                    ctx,
                )
            {
                return true;
            }
        }
        descendant_id = ancestor.id();
        descendant_span = ancestor.span();
        if ancestor.id() == render_owner.id() {
            break;
        }
    }
    false
}

fn ref_render_is_predictable_guarded_initialization<'a>(
    assignment_node: &AstNode<'a>,
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    guarded_branch: &AstNode<'a>,
    render_owner: &AstNode<'a>,
    ref_symbol_id: SymbolId,
    requires_closed_truthy_domain: bool,
    ctx: &LintContext<'a>,
) -> bool {
    ref_render_has_empty_sentinel_initializer(ref_symbol_id, ctx)
        && ref_render_is_predictable_initialization_value(
            &assignment.right,
            ref_symbol_id,
            render_owner,
            requires_closed_truthy_domain,
            ctx,
        )
        && !ref_render_has_repeated_ancestor(assignment_node, guarded_branch.id(), ctx)
        && (guarded_branch.id() == render_owner.id()
            || !ref_render_has_repeated_ancestor(guarded_branch, render_owner.id(), ctx))
        && ref_render_has_no_prior_write(assignment_node, render_owner, ref_symbol_id, ctx)
        && ref_render_has_no_competing_write(assignment_node, render_owner, ref_symbol_id, ctx)
        && ref_render_does_not_escape(render_owner, ref_symbol_id, ctx)
}

fn ref_render_same_current_alias<'a>(
    expression: &Expression<'a>,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    if ref_render_expression_symbol(expression, ctx) == Some(ref_symbol_id) {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(alias_symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(alias_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && declarator.init.as_ref().is_some_and(|initializer| {
            ref_render_expression_symbol(initializer, ctx) == Some(ref_symbol_id)
        })
}

fn ref_render_has_empty_sentinel_initializer(
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(call) = ref_render_ref_initializer_call(ref_symbol_id, ctx) else {
        return false;
    };
    call.arguments.is_empty()
        || call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| ref_render_is_empty_sentinel(argument, ctx))
}

fn ref_render_ref_initializer_call<'a, 'b>(
    ref_symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b oxc_ast::ast::CallExpression<'a>> {
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    ref_render_is_use_ref_call(call, ctx).then_some(call)
}

fn ref_render_is_empty_sentinel(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        _ => false,
    }
}

fn ref_render_resolve_immutable_value<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<&'b Expression<'a>> {
    let expression = expression.get_inner_expression();
    let Expression::Identifier(identifier) = expression else {
        return Some(expression);
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return None;
    }
    ref_render_resolve_immutable_value(declarator.init.as_ref()?, ctx, visited)
}

fn ref_render_is_provably_truthy<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let Some(expression) =
        ref_render_resolve_immutable_value(expression, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name.starts_with("create"))
        }
        Expression::NewExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_) => true,
        _ => false,
    }
}

fn ref_render_resolves_to_call<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return matches!(
            expression.get_inner_expression(),
            Expression::CallExpression(_)
        );
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| ref_render_resolves_to_call(initializer, ctx, visited))
}

fn ref_render_is_predictable_initialization_value<'a>(
    expression: &Expression<'a>,
    ref_symbol_id: SymbolId,
    render_owner: &AstNode<'a>,
    requires_closed_truthy_domain: bool,
    ctx: &LintContext<'a>,
) -> bool {
    ref_render_is_input_independent(expression, render_owner, ctx, &mut FxHashSet::default())
        && !ref_render_contains_non_deterministic_source(expression.span(), ctx)
        && ((ref_render_is_provably_truthy(expression, ctx)
            && (!requires_closed_truthy_domain
                || !ref_render_has_declared_type(ref_symbol_id, ctx)))
            || ref_render_has_closed_falsy_domain(ref_symbol_id, expression, ctx))
}

fn ref_render_is_input_independent<'a>(
    expression: &Expression<'a>,
    render_owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    for node in ctx.nodes().iter() {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            continue;
        };
        if !expression.span().contains_inclusive(identifier.span) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if ref_render_symbol_is_react_ref(symbol_id, ctx) {
            continue;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if matches!(
            declaration.kind(),
            AstKind::ImportSpecifier(_)
                | AstKind::ImportDefaultSpecifier(_)
                | AstKind::ImportNamespaceSpecifier(_)
        ) || !ctx.nodes().ancestors(declaration.id()).any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        }) {
            continue;
        }
        let is_parameter = matches!(declaration.kind(), AstKind::FormalParameter(_))
            || ctx
                .nodes()
                .ancestors(declaration.id())
                .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)));
        if is_parameter {
            let parameter_owner = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            });
            if parameter_owner.is_some_and(|owner| owner.id() == render_owner.id()) {
                return false;
            }
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(variable) = parent.kind() else {
            return false;
        };
        if !variable.kind.is_const()
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        if !visited.insert(symbol_id) {
            continue;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if !ref_render_is_input_independent(initializer, render_owner, ctx, visited) {
            return false;
        }
    }
    true
}

fn ref_render_inside_nested_function(
    node: &AstNode<'_>,
    root_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        root_span.contains_inclusive(ancestor.span())
            && matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
    })
}

fn ref_render_contains_non_deterministic_source(span: Span, ctx: &LintContext<'_>) -> bool {
    for node in ctx.nodes().iter() {
        if !span.contains_inclusive(node.span())
            || ref_render_inside_nested_function(node, span, ctx)
        {
            continue;
        }
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if new_expression.arguments.is_empty()
                    && matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Date") =>
            {
                return true;
            }
            AstKind::CallExpression(call) => match call.callee.get_inner_expression() {
                Expression::Identifier(identifier)
                    if REF_RENDER_NON_DETERMINISTIC_BARE_CALLS
                        .contains(&identifier.name.as_str()) =>
                {
                    return true;
                }
                expression => {
                    let Some(member) = expression.as_member_expression() else {
                        continue;
                    };
                    let Expression::Identifier(receiver) = member.object().get_inner_expression()
                    else {
                        continue;
                    };
                    if ref_render_member_identifier_property_name(member).is_some_and(|property| {
                        REF_RENDER_NON_DETERMINISTIC_MEMBER_CALLS
                            .contains(&(receiver.name.as_str(), property))
                    }) {
                        return true;
                    }
                }
            },
            _ => {}
        }
    }
    false
}

fn ref_render_member_identifier_property_name<'a>(
    member: &'a MemberExpression<'a>,
) -> Option<&'a str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn ref_render_has_declared_type(ref_symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ref_render_ref_initializer_call(ref_symbol_id, ctx)
        .and_then(|call| call.type_arguments.as_ref())
        .is_some_and(|arguments| !arguments.params.is_empty())
}

fn ref_render_has_closed_falsy_domain<'a, 'b>(
    ref_symbol_id: SymbolId,
    initialization_value: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let Some(call) = ref_render_ref_initializer_call(ref_symbol_id, ctx) else {
        return false;
    };
    if call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|initial| !ref_render_is_empty_sentinel(initial, ctx))
    {
        return false;
    }
    let Some(declared_type) = call
        .type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
    else {
        return false;
    };
    let mut has_truthy_domain = false;
    let members: &[TSType<'a>] = match declared_type {
        TSType::TSUnionType(union) => &union.types,
        single => std::slice::from_ref(single),
    };
    for member in members {
        if matches!(
            member,
            TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
        ) {
            continue;
        }
        if !ref_render_closed_truthy_type_matches(member, initialization_value, ctx) {
            return false;
        }
        has_truthy_domain = true;
    }
    has_truthy_domain
}

fn ref_render_closed_truthy_type_matches<'a, 'b>(
    type_node: &TSType<'a>,
    initialization_value: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> bool {
    let initialization_value = initialization_value.get_inner_expression();
    match type_node {
        TSType::TSTypeLiteral(_) => {
            matches!(initialization_value, Expression::ObjectExpression(_))
        }
        TSType::TSArrayType(_) | TSType::TSTupleType(_) => {
            matches!(initialization_value, Expression::ArrayExpression(_))
        }
        TSType::TSFunctionType(_) | TSType::TSConstructorType(_) => matches!(
            initialization_value,
            Expression::ArrowFunctionExpression(_)
                | Expression::FunctionExpression(_)
                | Expression::ClassExpression(_)
        ),
        TSType::TSObjectKeyword(_) => true,
        TSType::TSIndexedAccessType(_) => {
            matches!(initialization_value, Expression::ObjectExpression(_))
        }
        TSType::TSTypeReference(reference) => {
            matches!(initialization_value, Expression::ObjectExpression(_))
                || ref_render_matching_return_type(reference, initialization_value, ctx)
                || ref_render_type_name(&reference.type_name)
                    .zip(ref_render_initialization_name(initialization_value, ctx))
                    .is_some_and(|(type_name, value_name)| type_name == value_name.as_str())
        }
        _ => false,
    }
}

fn ref_render_type_name<'a>(type_name: &'a TSTypeName<'a>) -> Option<&'a str> {
    match type_name {
        TSTypeName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn ref_render_initialization_name<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<String> {
    let expression =
        ref_render_resolve_immutable_value(expression, ctx, &mut FxHashSet::default())?;
    let callee = match expression {
        Expression::NewExpression(new_expression) => &new_expression.callee,
        Expression::CallExpression(call) => &call.callee,
        _ => return None,
    };
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return None;
    };
    identifier
        .name
        .strip_prefix("create")
        .filter(|suffix| !suffix.is_empty())
        .or(Some(identifier.name.as_str()))
        .map(str::to_string)
}

fn ref_render_matching_return_type<'a>(
    reference: &oxc_ast::ast::TSTypeReference<'a>,
    initialization_value: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if ref_render_type_name(&reference.type_name) != Some("ReturnType") {
        return false;
    }
    let Some(TSType::TSTypeQuery(query)) = reference
        .type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
    else {
        return false;
    };
    let oxc_ast::ast::TSTypeQueryExprName::IdentifierReference(queried_identifier) =
        &query.expr_name
    else {
        return false;
    };
    let Expression::CallExpression(call) = initialization_value else {
        return false;
    };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let queried_symbol = ctx
        .scoping()
        .get_reference(queried_identifier.reference_id())
        .symbol_id();
    let callee_symbol = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id();
    match (queried_symbol, callee_symbol) {
        (Some(queried), Some(callee)) => queried == callee,
        (None, None) => queried_identifier.name == callee.name,
        _ => false,
    }
}

fn ref_render_has_repeated_ancestor(
    node: &AstNode<'_>,
    stop_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == stop_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::WhileStatement(_)
        ) {
            return true;
        }
    }
    true
}

fn ref_render_branch_constraints(
    node: &AstNode<'_>,
    stop_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashMap<NodeId, bool> {
    let mut constraints = FxHashMap::default();
    let node_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == stop_id {
            break;
        }
        let AstKind::IfStatement(if_statement) = ancestor.kind() else {
            continue;
        };
        if if_statement.consequent.span().contains_inclusive(node_span) {
            constraints.insert(ancestor.id(), true);
        } else if if_statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span().contains_inclusive(node_span))
        {
            constraints.insert(ancestor.id(), false);
        }
    }
    constraints
}

fn ref_render_constraints_compatible(
    first: &FxHashMap<NodeId, bool>,
    second: &FxHashMap<NodeId, bool>,
) -> bool {
    first
        .iter()
        .all(|(statement, branch)| second.get(statement).is_none_or(|other| other == branch))
}

fn ref_render_has_no_prior_write(
    assignment_node: &AstNode<'_>,
    render_owner: &AstNode<'_>,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let assignment_constraints =
        ref_render_branch_constraints(assignment_node, render_owner.id(), ctx);
    !ctx.nodes().iter().any(|candidate| {
        let AstKind::AssignmentExpression(candidate_assignment) = candidate.kind() else {
            return false;
        };
        candidate.span().start < assignment_node.span().start
            && render_owner.span().contains_inclusive(candidate.span())
            && ref_render_assignment_target_symbol(&candidate_assignment.left, ctx)
                == Some(ref_symbol_id)
            && !ref_render_has_repeated_ancestor(candidate, render_owner.id(), ctx)
            && ref_render_constraints_compatible(
                &assignment_constraints,
                &ref_render_branch_constraints(candidate, render_owner.id(), ctx),
            )
    })
}

fn ref_render_has_no_competing_write<'a>(
    assignment_node: &AstNode<'a>,
    render_owner: &AstNode<'a>,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let assignment_constraints =
        ref_render_branch_constraints(assignment_node, render_owner.id(), ctx);
    !ctx.nodes().iter().any(|candidate| {
        if candidate.id() == assignment_node.id()
            || !render_owner.span().contains_inclusive(candidate.span())
        {
            return false;
        }
        let (candidate_symbol, deferred_truthy_write) = match candidate.kind() {
            AstKind::AssignmentExpression(candidate_assignment) => {
                let symbol = ref_render_span_contains_ref_current(
                    candidate_assignment.left.span(),
                    ref_symbol_id,
                    ctx,
                )
                .then_some(ref_symbol_id);
                let is_deferred = find_render_phase_component_or_hook(candidate, ctx)
                    .is_none_or(|owner| owner.id() != render_owner.id())
                    && !ref_render_is_synchronously_invoked_local_function(
                        candidate,
                        render_owner,
                        ctx,
                        &mut FxHashSet::default(),
                    );
                let deferred_truthy = candidate_assignment.operator == AssignmentOperator::Assign
                    && is_deferred
                    && !ref_render_resolves_to_call(
                        &candidate_assignment.right,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                    && ref_render_is_provably_truthy(&candidate_assignment.right, ctx);
                (symbol, deferred_truthy)
            }
            AstKind::UpdateExpression(update) => (
                ref_render_span_contains_ref_current(update.argument.span(), ref_symbol_id, ctx)
                    .then_some(ref_symbol_id),
                false,
            ),
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => (
                ref_render_span_contains_ref_current(unary.argument.span(), ref_symbol_id, ctx)
                    .then_some(ref_symbol_id),
                false,
            ),
            AstKind::ForInStatement(statement) => (
                ref_render_span_contains_ref_current(statement.left.span(), ref_symbol_id, ctx)
                    .then_some(ref_symbol_id),
                false,
            ),
            AstKind::ForOfStatement(statement) => (
                ref_render_span_contains_ref_current(statement.left.span(), ref_symbol_id, ctx)
                    .then_some(ref_symbol_id),
                false,
            ),
            _ => return false,
        };
        candidate_symbol == Some(ref_symbol_id)
            && !deferred_truthy_write
            && ref_render_constraints_compatible(
                &assignment_constraints,
                &ref_render_branch_constraints(candidate, render_owner.id(), ctx),
            )
    })
}

fn ref_render_span_contains_ref_current(
    span: Span,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !ctx.source_range(span).contains("current") {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && candidate
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| {
                    member.static_property_name().as_deref() == Some("current")
                        && ref_render_current_object_symbol(member.object(), ctx)
                            == Some(ref_symbol_id)
                })
    })
}

fn ref_render_is_synchronously_invoked_local_function<'a>(
    node: &AstNode<'a>,
    render_owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    if function_node.id() == render_owner.id() {
        return true;
    }
    let Some(symbol_id) = ref_render_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let has_synchronous_write = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if find_render_phase_component_or_hook(reference_node, ctx)
                .is_some_and(|owner| owner.id() == render_owner.id())
            {
                return true;
            }
            let Some(write_function) = crate::ast_util::get_enclosing_function(reference_node, ctx)
            else {
                return false;
            };
            if write_function.id() == function_node.id() {
                return true;
            }
            let mut branch_symbols = visited_symbols.clone();
            ref_render_is_synchronously_invoked_local_function(
                reference_node,
                render_owner,
                ctx,
                &mut branch_symbols,
            )
        });
    if has_synchronous_write {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_read())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if !matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == reference_root.span())
            {
                return false;
            }
            find_render_phase_component_or_hook(parent, ctx)
                .is_some_and(|owner| owner.id() == render_owner.id())
                || {
                    let mut branch_symbols = visited_symbols.clone();
                    ref_render_is_synchronously_invoked_local_function(
                        parent,
                        render_owner,
                        ctx,
                        &mut branch_symbols,
                    )
                }
        })
}

fn ref_render_function_binding_symbol<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn ref_render_does_not_escape(
    render_owner: &AstNode<'_>,
    ref_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut pending_symbols = vec![ref_symbol_id];
    let mut visited_symbols = FxHashSet::default();
    while let Some(symbol_id) = pending_symbols.pop() {
        if !visited_symbols.insert(symbol_id) {
            continue;
        }
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let node = ctx.nodes().get_node(reference.node_id());
            if !render_owner.span().contains_inclusive(node.span()) {
                continue;
            }
            let root = transparent_expression_root(node, ctx);
            let parent = ctx.nodes().parent_node(root.id());
            if let Some(member) = parent.kind().as_member_expression_kind()
                && member.object().span() == root.span()
                && member.static_property_name().as_deref() == Some("current")
            {
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            let declaration = ctx.nodes().parent_node(parent.id());
            if !matches!(declaration.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || declarator
                    .init
                    .as_ref()
                    .is_none_or(|initializer| initializer.span() != root.span())
            {
                return false;
            }
            let Some(alias) = declarator.id.get_binding_identifier() else {
                return false;
            };
            pending_symbols.push(alias.symbol_id());
        }
    }
    true
}
