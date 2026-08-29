use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, CallExpression, Expression, JSXAttributeName, JSXElementName,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Coercing an input's value with this parse stores `0` for a cleared field and `NaN` for partial input, which then flows into state or a request body; guard the empty and NaN cases (for example `value ? Number(value) : undefined`) before using it.";

#[derive(Debug, Default, Clone)]
pub struct NoUnguardedNumericInputParse;

declare_oxc_lint!(
    /// Warns when an inline input handler parses its event value without guarding empty or NaN results.
    NoUnguardedNumericInputParse,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unguarded numeric parse of an input value.",
);

impl Rule for NoUnguardedNumericInputParse {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(parse_kind) = numeric_parse_kind(call, ctx) else {
            return;
        };
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        let Some(event_root) = event_value_root(argument) else {
            return;
        };
        let Some(handler) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(parameter_symbol_id) = first_parameter_symbol_id(handler) else {
            return;
        };
        if identifier_symbol_id(event_root, ctx) != Some(parameter_symbol_id)
            || !is_textual_input_element_handler(handler, ctx)
            || guarded_by_related_ancestor(node, event_root, parse_kind, handler.id(), ctx)
            || block_has_prior_empty_exit_guard(
                node,
                event_root,
                parse_kind.nan_guard_proves_non_empty(argument),
                handler.id(),
                ctx,
            )
            || parse_result_is_guarded(node, parse_kind, handler.id(), ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NumericParseKind {
    Number,
    Integer,
    Float,
}

impl NumericParseKind {
    fn nan_guard_proves_non_empty(self, argument: &Expression<'_>) -> bool {
        self != Self::Number || event_value_property(argument) == Some("valueAsNumber")
    }
}

fn numeric_parse_kind(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NumericParseKind> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) if ctx.is_reference_to_global_variable(identifier) => {
            match identifier.name.as_str() {
                "Number" => Some(NumericParseKind::Number),
                "parseInt" => Some(NumericParseKind::Integer),
                "parseFloat" => Some(NumericParseKind::Float),
                _ => None,
            }
        }
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = member.object().get_inner_expression();
            let Expression::Identifier(identifier) = receiver else {
                return None;
            };
            if identifier.name != "Number" || !ctx.is_reference_to_global_variable(identifier) {
                return None;
            }
            match static_member_expression_property_name(member)? {
                "parseInt" => Some(NumericParseKind::Integer),
                "parseFloat" => Some(NumericParseKind::Float),
                _ => None,
            }
        }
    }
}

fn event_value_root<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let value_member = expression.get_inner_expression().as_member_expression()?;
    if !matches!(
        static_member_expression_property_name(value_member),
        Some("value" | "valueAsNumber")
    ) {
        return None;
    }
    let target_member = value_member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if !matches!(
        static_member_expression_property_name(target_member),
        Some("target" | "currentTarget")
    ) {
        return None;
    }
    let Expression::Identifier(identifier) = target_member.object().get_inner_expression() else {
        return None;
    };
    Some(identifier)
}

fn event_value_property<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    static_member_expression_property_name(
        expression.get_inner_expression().as_member_expression()?,
    )
}

fn identifier_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn first_parameter_symbol_id(function_node: &AstNode<'_>) -> Option<SymbolId> {
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    }?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(identifier.symbol_id())
}

fn is_textual_input_element_handler(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let container = ctx.nodes().parent_node(function_node.id());
    if !matches!(container.kind(), AstKind::JSXExpressionContainer(_)) {
        return false;
    }
    let attribute_node = ctx.nodes().parent_node(container.id());
    let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
        return false;
    };
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return false;
    };
    let attribute_bytes = attribute_name.name.as_bytes();
    if !attribute_name.name.starts_with("on")
        || !attribute_bytes.get(2).is_some_and(u8::is_ascii_uppercase)
    {
        return false;
    }
    let opening_node = ctx.nodes().parent_node(attribute_node.id());
    let AstKind::JSXOpeningElement(opening) = opening_node.kind() else {
        return false;
    };
    if !matches!(&opening.name, JSXElementName::Identifier(identifier) if identifier.name == "input")
    {
        return false;
    }
    let input_type = find_jsx_attribute(opening, "type").and_then(|attribute| {
        get_string_literal_attribute_value(attribute).or_else(|| {
            let expression = match attribute.value.as_ref()? {
                oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
                    container.expression.as_expression()?
                }
                _ => return None,
            };
            let expression = match expression.get_inner_expression() {
                Expression::Identifier(identifier) => identifier_initializer(identifier, ctx)?,
                _ => expression,
            };
            get_static_string_expression(expression)
        })
    });
    if input_type == Some("range") {
        return false;
    }
    if !matches!(input_type, Some("checkbox" | "radio")) {
        return true;
    }
    let Some(value) = find_jsx_attribute(opening, "value")
        .and_then(direct_jsx_string_attribute_value)
        .map(str::trim)
    else {
        return true;
    };
    value.is_empty()
        || value
            .parse::<f64>()
            .ok()
            .is_none_or(|number| !number.is_finite())
}

fn direct_jsx_string_attribute_value<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn guarded_by_related_ancestor<'a>(
    call_node: &AstNode<'a>,
    event_root: &oxc_ast::ast::IdentifierReference<'a>,
    parse_kind: NumericParseKind,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let nan_guard_proves_non_empty = parse_kind.nan_guard_proves_non_empty(
        match call_node.kind() {
            AstKind::CallExpression(call) => {
                call.arguments.first().and_then(Argument::as_expression)
            }
            _ => None,
        }
        .expect("numeric parse has an argument"),
    );
    let mut child = call_node;
    loop {
        let ancestor = ctx.nodes().parent_node(child.id());
        if ancestor.id() == handler_id {
            return false;
        }
        match ancestor.kind() {
            AstKind::ConditionalExpression(conditional) => {
                let branch_when_truthy = conditional
                    .consequent
                    .span()
                    .contains_inclusive(child.span());
                if (branch_when_truthy
                    || conditional
                        .alternate
                        .span()
                        .contains_inclusive(child.span()))
                    && branch_proves_event_value_state(
                        &conditional.test,
                        event_root,
                        branch_when_truthy,
                        true,
                        nan_guard_proves_non_empty,
                        ctx,
                    )
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(logical) => {
                if logical.left.span() == child.span() && logical.operator == LogicalOperator::Or {
                    return true;
                }
                if logical.right.span().contains_inclusive(child.span())
                    && logical.operator != LogicalOperator::Coalesce
                    && branch_proves_event_value_state(
                        &logical.left,
                        event_root,
                        logical.operator == LogicalOperator::And,
                        true,
                        nan_guard_proves_non_empty,
                        ctx,
                    )
                {
                    return true;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        child = ancestor;
    }
}

fn branch_proves_event_value_state<'a>(
    test: &Expression<'a>,
    event_root: &oxc_ast::ast::IdentifierReference<'a>,
    branch_when_truthy: bool,
    expected_non_empty: bool,
    nan_guard_proves_non_empty: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let test = test.get_inner_expression();
    if same_event_value_access(test, event_root, ctx) {
        return branch_when_truthy == expected_non_empty;
    }
    match test {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            branch_proves_event_value_state(
                &unary.argument,
                event_root,
                !branch_when_truthy,
                expected_non_empty,
                nan_guard_proves_non_empty,
                ctx,
            )
        }
        Expression::LogicalExpression(logical)
            if branch_when_truthy && logical.operator == LogicalOperator::And
                || !branch_when_truthy && logical.operator == LogicalOperator::Or =>
        {
            branch_proves_event_value_state(
                &logical.left,
                event_root,
                branch_when_truthy,
                expected_non_empty,
                nan_guard_proves_non_empty,
                ctx,
            ) || branch_proves_event_value_state(
                &logical.right,
                event_root,
                branch_when_truthy,
                expected_non_empty,
                nan_guard_proves_non_empty,
                ctx,
            )
        }
        Expression::CallExpression(call) if expected_non_empty => {
            let Some(guard_kind) = nan_guard_kind(call, ctx) else {
                return false;
            };
            let guards_event_value = call
                .arguments
                .iter()
                .filter_map(Argument::as_expression)
                .any(|argument| same_event_value_access(argument, event_root, ctx));
            let guards_value_as_number = call
                .arguments
                .iter()
                .filter_map(Argument::as_expression)
                .any(|argument| event_value_property(argument) == Some("valueAsNumber"));
            guards_event_value
                && (nan_guard_proves_non_empty || guards_value_as_number)
                && branch_when_truthy == guard_kind.valid_when_truthy()
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let has_value_and_empty = same_event_value_access(&binary.left, event_root, ctx)
                && is_empty_string(&binary.right)
                || same_event_value_access(&binary.right, event_root, ctx)
                    && is_empty_string(&binary.left);
            if !has_value_and_empty {
                return false;
            }
            let equality = matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            );
            let branch_proves_empty = branch_when_truthy == equality;
            branch_proves_empty != expected_non_empty
        }
        _ => false,
    }
}

fn same_event_value_access(
    candidate: &Expression<'_>,
    event_root: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(candidate_root) = event_value_root(candidate) else {
        return false;
    };
    identifier_symbol_id(candidate_root, ctx) == identifier_symbol_id(event_root, ctx)
}

fn is_empty_string(expression: &Expression<'_>) -> bool {
    get_static_string_expression(expression) == Some("")
}

fn block_has_prior_empty_exit_guard<'a>(
    call_node: &AstNode<'a>,
    event_root: &oxc_ast::ast::IdentifierReference<'a>,
    nan_guard_proves_non_empty: bool,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let block_ids = ctx
        .nodes()
        .ancestors(call_node.id())
        .take_while(|ancestor| ancestor.id() != handler_id)
        .filter_map(|ancestor| {
            matches!(ancestor.kind(), AstKind::BlockStatement(_)).then_some(ancestor.id())
        })
        .collect::<Vec<_>>();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(statement) = candidate.kind() else {
            return false;
        };
        candidate.span().end <= call_node.span().start
            && block_ids.contains(&ctx.nodes().parent_node(candidate.id()).id())
            && directly_exits(&statement.consequent)
            && branch_proves_event_value_state(
                &statement.test,
                event_root,
                true,
                false,
                nan_guard_proves_non_empty,
                ctx,
            )
    })
}

fn directly_exits(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => matches!(
            block.body.last(),
            Some(Statement::ReturnStatement(_) | Statement::ThrowStatement(_))
        ),
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum NanGuardKind {
    IsNan,
    IsFinite,
    IsInteger,
}

impl NanGuardKind {
    fn valid_when_truthy(self) -> bool {
        !matches!(self, Self::IsNan)
    }
}

fn nan_guard_kind(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> Option<NanGuardKind> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) if ctx.is_reference_to_global_variable(identifier) => {
            match identifier.name.as_str() {
                "isNaN" => Some(NanGuardKind::IsNan),
                "isFinite" => Some(NanGuardKind::IsFinite),
                _ => None,
            }
        }
        expression => {
            let member = expression.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            if receiver.name != "Number" || !ctx.is_reference_to_global_variable(receiver) {
                return None;
            }
            match static_member_expression_property_name(member)? {
                "isNaN" => Some(NanGuardKind::IsNan),
                "isFinite" => Some(NanGuardKind::IsFinite),
                "isInteger" => Some(NanGuardKind::IsInteger),
                _ => None,
            }
        }
    }
}

fn parse_result_is_guarded<'a>(
    call_node: &AstNode<'a>,
    parse_kind: NumericParseKind,
    handler_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    if parse_kind == NumericParseKind::Number {
        let AstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            return false;
        };
        if event_value_property(argument) != Some("valueAsNumber") {
            return false;
        }
    }
    let Some(binding_symbol_id) = parse_result_binding_symbol_id(call_node, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|guard_node| {
        let AstKind::CallExpression(guard_call) = guard_node.kind() else {
            return false;
        };
        if guard_node.span().start <= call_node.span().end
            || crate::ast_util::get_enclosing_function(guard_node, ctx).map(AstNode::id)
                != Some(handler_id)
        {
            return false;
        }
        let Some(guard_kind) = nan_guard_kind(guard_call, ctx) else {
            return false;
        };
        if !expression_list_references_symbol(&guard_call.arguments, binding_symbol_id, ctx) {
            return false;
        }
        guard_protects_every_use(
            guard_node,
            guard_kind,
            binding_symbol_id,
            call_node.span(),
            ctx,
        )
    })
}

fn parse_result_binding_symbol_id(
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut wrapped = call_node;
    loop {
        let parent = ctx.nodes().parent_node(wrapped.id());
        match parent.kind() {
            AstKind::VariableDeclarator(declarator) => {
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|binding| binding.symbol_id());
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_) => wrapped = parent,
            AstKind::CallExpression(call)
                if call
                    .arguments
                    .iter()
                    .filter_map(Argument::as_expression)
                    .any(|argument| argument.span().contains_inclusive(wrapped.span())) =>
            {
                wrapped = parent;
            }
            _ => return None,
        }
    }
}

fn expression_list_references_symbol(
    arguments: &[Argument<'_>],
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    arguments.iter().any(|argument| {
        let Some(expression) = argument.as_expression() else {
            return false;
        };
        ctx.nodes().iter().any(|candidate| {
            expression.span().contains_inclusive(candidate.span())
                && matches!(candidate.kind(), AstKind::IdentifierReference(identifier)
                    if identifier_symbol_id(identifier, ctx) == Some(symbol_id))
        })
    })
}

fn guard_protects_every_use<'a>(
    guard_node: &AstNode<'a>,
    guard_kind: NanGuardKind,
    symbol_id: SymbolId,
    parse_span: Span,
    ctx: &LintContext<'a>,
) -> bool {
    let mut test_root = transparent_expression_root(guard_node, ctx);
    let mut valid_when_truthy = guard_kind.valid_when_truthy();
    let parent = ctx.nodes().parent_node(test_root.id());
    if matches!(parent.kind(), AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot)
    {
        test_root = parent;
        valid_when_truthy = !valid_when_truthy;
    }
    let guard_parent = ctx.nodes().parent_node(test_root.id());
    let (test_span, valid_span, invalid_exit_end) = match guard_parent.kind() {
        AstKind::IfStatement(statement) if statement.test.span() == test_root.span() => {
            if valid_when_truthy {
                (
                    statement.test.span(),
                    Some(statement.consequent.span()),
                    None,
                )
            } else if directly_exits(&statement.consequent) {
                (statement.test.span(), None, Some(guard_parent.span().end))
            } else {
                return false;
            }
        }
        AstKind::ConditionalExpression(conditional)
            if valid_when_truthy && conditional.test.span() == test_root.span() =>
        {
            (
                conditional.test.span(),
                Some(conditional.consequent.span()),
                None,
            )
        }
        _ => return false,
    };
    let references = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| {
            let span = ctx.nodes().get_node(reference.node_id()).span();
            span.start > parse_span.end && !test_span.contains_inclusive(span)
        });
    let mut saw_reference = false;
    for reference in references {
        saw_reference = true;
        let span = ctx.nodes().get_node(reference.node_id()).span();
        if let Some(valid_span) = valid_span {
            if !valid_span.contains_inclusive(span) {
                return false;
            }
        } else if invalid_exit_end.is_none_or(|end| span.start <= end) {
            return false;
        }
    }
    saw_reference || invalid_exit_end.is_some()
}
