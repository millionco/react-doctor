use oxc_ast::{
    AstKind,
    ast::{Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{context::LintContext, rule::Rule};

const TIMER_SET_NAMES: [&str; 2] = ["setInterval", "setTimeout"];
const TIMER_CLEAR_NAMES: [&str; 2] = ["clearInterval", "clearTimeout"];
const GLOBAL_TIMER_RECEIVER_NAMES: [&str; 3] = ["window", "globalThis", "self"];

#[derive(Debug, Default, Clone)]
pub struct NoStaleTimerRef;

declare_oxc_lint!(
    /// Warns when a cleared timer ref remains truthy after cancellation.
    NoStaleTimerRef,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a cleared timer ref keeps its stale id.",
);

impl Rule for NoStaleTimerRef {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let clear_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return None;
                };
                parse_timer_ref_clear(call, ctx).map(|_| node.id())
            })
            .collect::<Vec<_>>();
        if clear_call_ids.is_empty() {
            return;
        }

        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for call_id in clear_call_ids {
            let call_node = ctx.nodes().get_node(call_id);
            let AstKind::CallExpression(call) = call_node.kind() else {
                continue;
            };
            let Some((clear_name, ref_symbol_id)) = parse_timer_ref_clear(call, ctx) else {
                continue;
            };
            if bare_timer_callee_is_shadowed(call, ctx) || !symbol_is_use_ref(ref_symbol_id, ctx) {
                continue;
            }
            let ref_name = ctx.scoping().symbol_name(ref_symbol_id);
            let owner_id = timer_ref_scope_owner(ref_symbol_id, ctx);
            let owner_span = ctx.nodes().get_node(owner_id).span();
            let (holds_timer_id, has_pending_read) =
                collect_timer_ref_usage(ref_name, owner_span, ctx);
            if !holds_timer_id
                || !has_pending_read
                || is_inside_effect_cleanup(call_id, owner_span, ctx, &mut resolution_cache)
                || has_ref_reassignment_after_clear(call_id, ref_name, ctx)
            {
                continue;
            }
            let message = format!(
                "`{clear_name}({ref_name}.current)` cancels the timer but leaves the old id in `{ref_name}.current`, and this component reads `{ref_name}.current` as a “timer pending” signal — assign `{ref_name}.current = null` right after clearing so a cancelled timer does not look pending."
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call.span));
        }
    }
}

fn global_timer_callee_name<'a>(call: &'a oxc_ast::ast::CallExpression<'a>) -> Option<&'a str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => {
            let member = expression.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            GLOBAL_TIMER_RECEIVER_NAMES
                .contains(&receiver.name.as_str())
                .then(|| member.static_property_name())
                .flatten()
        }
    }
}

fn bare_timer_callee_is_shadowed(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some()
}

fn parse_timer_ref_clear<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a str, SymbolId)> {
    let (clear_name, _) = parse_timer_ref_clear_name(call)?;
    let argument = call.arguments.first()?.as_expression()?;
    let symbol_id = ref_current_symbol(argument, ctx)?;
    Some((clear_name, symbol_id))
}

fn parse_timer_ref_clear_name<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<(&'a str, &'a str)> {
    let clear_name = global_timer_callee_name(call)?;
    if !TIMER_CLEAR_NAMES.contains(&clear_name) {
        return None;
    }
    let argument = call.arguments.first()?.as_expression()?;
    let member = argument.get_inner_expression().as_member_expression()?;
    let oxc_ast::ast::MemberExpression::StaticMemberExpression(member) = member else {
        return None;
    };
    if member.property.name != "current" {
        return None;
    }
    let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
        return None;
    };
    Some((clear_name, receiver.name.as_str()))
}

fn ref_current_symbol(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let member = expression.get_inner_expression().as_member_expression()?;
    if member.static_property_name() != Some("current")
        || !matches!(
            member,
            oxc_ast::ast::MemberExpression::StaticMemberExpression(_)
        )
    {
        return None;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
}

fn symbol_is_use_ref(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return false;
    };
    is_react_hook_call(call, &["useRef"], ctx)
}

fn timer_ref_scope_owner(symbol_id: SymbolId, ctx: &LintContext<'_>) -> NodeId {
    let declaration = ctx.symbol_declaration(symbol_id);
    ctx.nodes()
        .ancestors(declaration.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
            )
        })
        .map_or(declaration.id(), |owner| owner.id())
}

fn collect_timer_ref_usage(
    ref_name: &str,
    owner_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> (bool, bool) {
    let mut holds_timer_id = false;
    let mut has_pending_read = false;
    for candidate in ctx.nodes().iter() {
        if !owner_span.contains_inclusive(candidate.span()) {
            continue;
        }
        if let AstKind::AssignmentExpression(assignment) = candidate.kind()
            && assignment.operator == AssignmentOperator::Assign
            && assignment
                .left
                .as_member_expression()
                .is_some_and(|member| member_is_ref_current(member, ref_name))
        {
            holds_timer_id |= matches!(
                assignment.right.get_inner_expression(),
                Expression::CallExpression(call)
                    if global_timer_callee_name(call)
                        .is_some_and(|name| TIMER_SET_NAMES.contains(&name))
            );
            continue;
        }
        let AstKind::StaticMemberExpression(member) = candidate.kind() else {
            continue;
        };
        if member.property.name == "current"
            && matches!(member.object.get_inner_expression(), Expression::Identifier(receiver) if receiver.name == ref_name)
            && is_pending_signal_read(candidate.id(), ref_name, ctx)
        {
            has_pending_read = true;
        }
    }
    (holds_timer_id, has_pending_read)
}

fn member_is_ref_current(member: &oxc_ast::ast::MemberExpression<'_>, ref_name: &str) -> bool {
    if member.static_property_name() != Some("current")
        || !matches!(
            member,
            oxc_ast::ast::MemberExpression::StaticMemberExpression(_)
        )
    {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    receiver.name == ref_name
}

fn is_pending_signal_read(member_id: NodeId, ref_name: &str, ctx: &LintContext<'_>) -> bool {
    let mut current = ctx.nodes().get_node(member_id);
    let mut logical_ids = Vec::new();
    let mut passed_boolean_projection = false;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let may_climb = match parent.kind() {
            AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_) => true,
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                passed_boolean_projection = true;
                true
            }
            AstKind::BinaryExpression(binary)
                if matches!(
                    binary.operator,
                    BinaryOperator::Equality
                        | BinaryOperator::Inequality
                        | BinaryOperator::StrictEquality
                        | BinaryOperator::StrictInequality
                ) && (is_nullish_expression(&binary.left)
                    || is_nullish_expression(&binary.right)) =>
            {
                passed_boolean_projection = true;
                true
            }
            AstKind::LogicalExpression(_) => {
                logical_ids.push(parent.id());
                true
            }
            _ => false,
        };
        if !may_climb {
            break;
        }
        current = parent;
    }

    let parent = ctx.nodes().parent_node(current.id());
    match parent.kind() {
        AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
            !(is_clear_guard_if(statement, ref_name, ctx)
                || is_early_exit_before_clear(statement, ref_name, ctx))
        }
        AstKind::ConditionalExpression(statement) if statement.test.span() == current.span() => {
            true
        }
        AstKind::WhileStatement(statement) if statement.test.span() == current.span() => true,
        AstKind::DoWhileStatement(statement) if statement.test.span() == current.span() => true,
        AstKind::ForStatement(statement)
            if statement
                .test
                .as_ref()
                .is_some_and(|test| test.span() == current.span()) =>
        {
            true
        }
        _ if !logical_ids.is_empty() => !logical_ids.iter().any(|logical_id| {
            matches!(ctx.nodes().get_node(*logical_id).kind(), AstKind::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And
                    && expression_is_clear_call(&logical.right, ref_name))
        }),
        _ => passed_boolean_projection,
    }
}

fn expression_is_clear_call(expression: &Expression<'_>, ref_name: &str) -> bool {
    matches!(expression.get_inner_expression(), Expression::CallExpression(call)
        if parse_timer_ref_clear_name(call).is_some_and(|(_, receiver_name)| receiver_name == ref_name))
}

fn statement_only_clears_ref(statement: &Statement<'_>, ref_name: &str) -> bool {
    match statement {
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .all(|statement| statement_only_clears_ref(statement, ref_name)),
        Statement::IfStatement(statement) if statement.alternate.is_none() => {
            statement_only_clears_ref(&statement.consequent, ref_name)
        }
        Statement::ExpressionStatement(statement) => {
            if expression_is_clear_call(&statement.expression, ref_name) {
                return true;
            }
            let Expression::AssignmentExpression(assignment) =
                statement.expression.get_inner_expression()
            else {
                return false;
            };
            assignment.operator == AssignmentOperator::Assign
                && assignment
                    .left
                    .as_member_expression()
                    .is_some_and(|member| member_is_ref_current(member, ref_name))
                && is_nullish_expression(&assignment.right)
        }
        _ => false,
    }
}

fn is_clear_guard_if(
    statement: &oxc_ast::ast::IfStatement<'_>,
    ref_name: &str,
    _ctx: &LintContext<'_>,
) -> bool {
    statement.alternate.is_none() && statement_only_clears_ref(&statement.consequent, ref_name)
}

fn is_early_exit_before_clear(
    statement: &oxc_ast::ast::IfStatement<'_>,
    ref_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if statement.alternate.is_some() || !timer_ref_statement_is_early_exit(&statement.consequent) {
        return false;
    }
    let Some(parent) = ctx
        .nodes()
        .iter()
        .find(|candidate| matches!(candidate.kind(), AstKind::IfStatement(candidate_if) if candidate_if.span == statement.span))
        .map(|node| ctx.nodes().parent_node(node.id()))
    else {
        return false;
    };
    let AstKind::BlockStatement(block) = parent.kind() else {
        return false;
    };
    let Some(index) = block
        .body
        .iter()
        .position(|candidate| candidate.span() == statement.span)
    else {
        return false;
    };
    index + 1 < block.body.len()
        && block.body[index + 1..]
            .iter()
            .all(|following| statement_only_clears_ref(following, ref_name))
}

fn timer_ref_statement_is_early_exit(statement: &Statement<'_>) -> bool {
    statement_always_exits(statement)
        || matches!(
            statement,
            Statement::BreakStatement(_) | Statement::ContinueStatement(_)
        )
        || matches!(statement, Statement::BlockStatement(block)
            if block.body.last().is_some_and(timer_ref_statement_is_early_exit))
}

fn has_ref_reassignment_after_clear(
    clear_call_id: NodeId,
    ref_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let clear_node = ctx.nodes().get_node(clear_call_id);
    let Some(function_id) = local_callback_nearest_function_id(clear_node.id(), ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        candidate.span().start > clear_node.span().start
            && local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id)
            && assignment.operator == AssignmentOperator::Assign
            && assignment
                .left
                .as_member_expression()
                .is_some_and(|member| member_is_ref_current(member, ref_name))
    })
}

fn is_inside_effect_cleanup<'a>(
    clear_call_id: NodeId,
    owner_span: oxc_span::Span,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let effect_callback_ids = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return None;
            };
            if !owner_span.contains_inclusive(candidate.span())
                || !is_react_hook_call(call, &["useEffect", "useLayoutEffect"], ctx)
            {
                return None;
            }
            let callback = call.arguments.first()?.as_expression()?;
            exact_local_function_id(callback, ctx, &mut Vec::new(), resolution_cache)
        })
        .collect::<Vec<_>>();
    if effect_callback_ids.is_empty() {
        return false;
    }

    let mut function_ids = ctx
        .nodes()
        .ancestors(clear_call_id)
        .filter(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(|ancestor| ancestor.id())
        .collect::<Vec<_>>();
    function_ids.reverse();
    for &function_id in &function_ids {
        if effect_callback_ids.iter().any(|&effect_callback_id| {
            function_is_directly_returned_from(function_id, effect_callback_id, ctx)
        }) {
            return true;
        }
        let Some(binding_symbol_id) = function_binding_symbol_id(function_id, ctx) else {
            continue;
        };
        if effect_callback_ids.iter().any(|&effect_callback_id| {
            function_is_returned_from(function_id, binding_symbol_id, effect_callback_id, ctx)
        }) {
            return true;
        }
    }
    false
}

fn function_binding_symbol_id(function_id: NodeId, ctx: &LintContext<'_>) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.is_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind() {
        return declarator
            .id
            .get_binding_identifier()
            .map(|binding| binding.symbol_id());
    }
    if let AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment.right.span() == function_root.span()
        && let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
            &assignment.left
    {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
    }
    if let AstKind::CallExpression(_) = parent.kind() {
        let call_root = transparent_expression_root(parent, ctx);
        let call_parent = ctx.nodes().parent_node(call_root.id());
        if let AstKind::VariableDeclarator(declarator) = call_parent.kind() {
            return declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id());
        }
    }
    None
}

fn function_is_directly_returned_from(
    function_id: NodeId,
    effect_callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if matches!(parent.kind(), AstKind::ReturnStatement(_))
        && local_callback_nearest_function_id(parent.id(), ctx) == Some(effect_callback_id)
    {
        return true;
    }
    matches!(ctx.nodes().get_node(effect_callback_id).kind(), AstKind::ArrowFunctionExpression(effect_callback)
        if effect_callback.get_expression().is_some_and(|body| body.span() == function_root.span()))
}

fn function_is_returned_from(
    _function_id: NodeId,
    binding_symbol_id: SymbolId,
    effect_callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            return false;
        };
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(effect_callback_id) {
            return false;
        }
        matches!(statement.argument.as_ref().map(Expression::get_inner_expression),
            Some(Expression::Identifier(identifier))
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                    == Some(binding_symbol_id))
    })
}
