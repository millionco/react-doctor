use oxc_ast::{
    AstKind,
    ast::{
        BinaryExpression, CallExpression, Expression, JSXAttribute, JSXAttributeItem,
        JSXAttributeName, JSXAttributeValue, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This text-entry Enter handler commits/submits without bailing on IME composition, so it fires mid-composition for CJK users pressing Enter to confirm a candidate. Bail first with `if (e.nativeEvent.isComposing) return;` (or track `onCompositionStart`/`onCompositionEnd`) before acting on Enter.";
const NON_TEXT_INPUT_TYPES: [&str; 18] = [
    "radio",
    "checkbox",
    "button",
    "submit",
    "reset",
    "file",
    "range",
    "color",
    "image",
    "hidden",
    "number",
    "password",
    "tel",
    "date",
    "time",
    "week",
    "month",
    "datetime-local",
];
const NON_TEXT_ENTRY_ROLES: [&str; 14] = [
    "button",
    "radio",
    "checkbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "switch",
    "link",
    "slider",
    "spinbutton",
    "treeitem",
    "gridcell",
];

#[derive(Debug, Default, Clone)]
pub struct NoEnterSubmitWithoutImeCompositionGuard;

declare_oxc_lint!(
    /// Require IME composition protection before Enter commits text input.
    NoEnterSubmitWithoutImeCompositionGuard,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an IME composition guard before Enter submit.",
);

impl Rule for NoEnterSubmitWithoutImeCompositionGuard {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        if file_is_non_react_jsx_dialect(ctx) || !ime_is_text_entry(opening, ctx) {
            return;
        }
        let Some(handler_node) = ime_handler_node(opening, ctx) else {
            return;
        };
        for candidate in ctx.nodes().iter() {
            let AstKind::BinaryExpression(binary) = candidate.kind() else {
                continue;
            };
            if ime_nearest_function_id(candidate, ctx) != Some(handler_node.id())
                || !ime_is_enter_test(binary)
            {
                continue;
            }
            let Some(branch) = ime_analyze_enter_branch(candidate, ctx) else {
                continue;
            };
            if ime_composition_is_active_when_predicate(branch.test, true, ctx) == Some(false)
                || ime_has_prior_composition_early_exit(
                    handler_node.span(),
                    branch.test.span(),
                    ctx,
                )
                || ime_expression_requires_modifier(
                    branch.test,
                    true,
                    ctx,
                    &mut FxHashSet::default(),
                )
                || ime_scope_uses_space(branch.test, ctx)
                || !ime_branch_performs_commit(branch.action_span, handler_node.id(), ctx)
                || ime_scope_commits_are_composition_guarded(
                    branch.action_span,
                    handler_node.id(),
                    &mut FxHashSet::default(),
                    ctx,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening.name.span()));
            return;
        }
    }
}

fn ime_attribute<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'a JSXAttribute<'a>> {
    opening
        .attributes
        .iter()
        .find_map(|item| match item {
            JSXAttributeItem::Attribute(attribute)
                if matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name.eq_ignore_ascii_case(name)) =>
            {
                Some(attribute)
            }
            _ => None,
        })
        .map(|attribute| &**attribute)
}

fn ime_static_string<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => Some(value.value.as_str()),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                Some(Expression::StringLiteral(value)) => Some(value.value.as_str()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn ime_potentially_truthy(attribute: &JSXAttribute<'_>) -> bool {
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                Some(Expression::BooleanLiteral(value)) => value.value,
                Some(Expression::NullLiteral(_)) => false,
                Some(Expression::UnaryExpression(unary)) if is_literal_void_expression(unary) => {
                    false
                }
                _ => true,
            }
        }
        _ => true,
    }
}

fn ime_is_text_entry<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let tag_name = opening
        .name
        .get_identifier_name()
        .map_or("", |name| name.as_str());
    let role = ime_attribute(opening, "role")
        .and_then(ime_static_string)
        .unwrap_or("");
    if NON_TEXT_ENTRY_ROLES.contains(&role)
        || ["readOnly", "disabled"]
            .iter()
            .any(|name| ime_attribute(opening, name).is_some_and(ime_potentially_truthy))
    {
        return false;
    }
    if ime_attribute(opening, "inputMode")
        .and_then(ime_static_string)
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "numeric" | "decimal"))
        || ime_numeric_change_handler(opening, ctx)
    {
        return false;
    }
    if tag_name.eq_ignore_ascii_case("textarea") {
        return true;
    }
    if tag_name.eq_ignore_ascii_case("input") {
        if let Some(input_type) = ime_attribute(opening, "type").and_then(ime_static_string) {
            return !NON_TEXT_INPUT_TYPES
                .iter()
                .any(|candidate| input_type.eq_ignore_ascii_case(candidate));
        }
        return !ime_dynamic_input_type_can_be_non_text(opening, ctx);
    }
    if ime_attribute(opening, "contentEditable").is_some_and(ime_content_editable_is_editable) {
        return true;
    }
    matches!(role, "textbox" | "searchbox" | "combobox")
}

fn ime_handler_node<'a, 'b>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    for attribute_name in ["onKeyDown", "onKeyUp"] {
        let Some(attribute) = ime_attribute(opening, attribute_name) else {
            continue;
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref()
        else {
            continue;
        };
        let Some(expression) = container.expression.as_expression() else {
            continue;
        };
        if let Some(function) = ime_resolve_function_expression(expression, ctx) {
            return Some(function);
        }
    }
    None
}

fn ime_resolve_function_expression<'a, 'b>(
    expression: &Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::FunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_) => Some(declaration),
                AstKind::VariableDeclarator(declarator) => {
                    ime_resolve_function_expression(declarator.init.as_ref()?, ctx)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn ime_dynamic_input_type_can_be_non_text(
    opening: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) =
        ime_attribute(opening, "type").and_then(|attribute| attribute.value.as_ref())
    else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        expression.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::StringLiteral(literal)
                if NON_TEXT_INPUT_TYPES.iter().any(|input_type| literal.value.eq_ignore_ascii_case(input_type)))
    })
}

fn ime_content_editable_is_editable(attribute: &JSXAttribute<'_>) -> bool {
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => value.value != "false",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                Some(Expression::BooleanLiteral(value)) => value.value,
                Some(Expression::StringLiteral(value)) => value.value != "false",
                _ => true,
            }
        }
        _ => true,
    }
}

fn ime_numeric_change_handler<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) =
        ime_attribute(opening, "onChange").and_then(|attribute| attribute.value.as_ref())
    else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    let Some(handler) = ime_resolve_function_expression(expression, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !handler.span().contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryPlus => {
                ime_expression_reads_value_member(&unary.argument, ctx)
            }
            AstKind::CallExpression(call) => ime_call_coerces_value_numerically(call, ctx),
            _ => false,
        }
    })
}

fn ime_call_coerces_value_numerically(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let callee = call.callee.get_inner_expression();
    let numeric_callee = match callee {
        Expression::Identifier(identifier) => {
            matches!(
                identifier.name.as_str(),
                "Number" | "parseInt" | "parseFloat"
            )
        }
        Expression::StaticMemberExpression(member) => {
            matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Number")
                && matches!(
                    member.property.name.as_str(),
                    "Number" | "parseInt" | "parseFloat"
                )
        }
        _ => false,
    };
    if numeric_callee {
        return call
            .arguments
            .first()
            .and_then(|argument| argument.as_expression())
            .is_some_and(|argument| ime_expression_reads_value_member(argument, ctx));
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some("replace")
        || !ime_expression_reads_value_member(member.object(), ctx)
    {
        return false;
    }
    let Some(source) = ctx
        .source_text()
        .get(call.span.start as usize..call.span.end as usize)
    else {
        return false;
    };
    source.contains(r"/\D") || source.contains("/[^0-9]") || source.contains(r"/[^\d]")
}

fn ime_expression_reads_value_member(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        expression.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::StaticMemberExpression(member) if member.property.name == "value")
            || expression.span().contains_inclusive(candidate.span())
                && matches!(candidate.kind(), AstKind::ComputedMemberExpression(member) if member.static_property_name().as_deref() == Some("value"))
    })
}

struct ImeEnterBranch<'a, 'b> {
    test: &'b Expression<'a>,
    action_span: Span,
}

fn ime_is_enter_test(binary: &BinaryExpression<'_>) -> bool {
    if !matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ) {
        return false;
    }
    ime_member_matches_enter_value(&binary.left, &binary.right)
        || ime_member_matches_enter_value(&binary.right, &binary.left)
}

fn ime_member_matches_enter_value(member: &Expression<'_>, value: &Expression<'_>) -> bool {
    let Some(property_name) = member
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member| member.static_property_name())
    else {
        return false;
    };
    match (property_name.as_ref(), value.get_inner_expression()) {
        ("key", Expression::StringLiteral(value)) => value.value == "Enter",
        ("keyCode" | "which", Expression::NumericLiteral(value)) => value.value == 13.0,
        _ => false,
    }
}

fn ime_analyze_enter_branch<'a, 'b>(
    enter_test: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<ImeEnterBranch<'a, 'b>> {
    let mut previous_span = enter_test.span();
    for ancestor in ctx.nodes().ancestors(enter_test.id()) {
        match ancestor.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            AstKind::IfStatement(statement) => {
                return (statement.test.span() == previous_span).then_some(ImeEnterBranch {
                    test: &statement.test,
                    action_span: statement.consequent.span(),
                });
            }
            AstKind::ConditionalExpression(expression) => {
                return (expression.test.span() == previous_span).then_some(ImeEnterBranch {
                    test: &expression.test,
                    action_span: expression.consequent.span(),
                });
            }
            AstKind::ExpressionStatement(statement) => {
                let expression = statement.expression.get_inner_expression();
                return matches!(expression, Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And)
                    .then_some(ImeEnterBranch {
                        test: &statement.expression,
                        action_span: statement.expression.span(),
                    });
            }
            _ => previous_span = ancestor.span(),
        }
    }
    None
}

fn ime_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn ime_expression_requires_modifier<'a>(
    expression: &Expression<'a>,
    predicate_result: bool,
    ctx: &LintContext<'a>,
    visited_functions: &mut FxHashSet<NodeId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            ime_expression_requires_modifier(
                &unary.argument,
                !predicate_result,
                ctx,
                visited_functions,
            )
        }
        Expression::LogicalExpression(logical) => match (logical.operator, predicate_result) {
            (LogicalOperator::And, true) | (LogicalOperator::Or, false) => {
                ime_expression_requires_modifier(
                    &logical.left,
                    predicate_result,
                    ctx,
                    visited_functions,
                ) || ime_expression_requires_modifier(
                    &logical.right,
                    predicate_result,
                    ctx,
                    visited_functions,
                )
            }
            (LogicalOperator::Or, true) => {
                ime_expression_requires_modifier(&logical.left, true, ctx, visited_functions)
                    && ime_expression_requires_modifier(
                        &logical.right,
                        true,
                        ctx,
                        visited_functions,
                    )
            }
            _ => false,
        },
        expression if expression.as_member_expression().is_some() => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .is_some_and(|property| {
                predicate_result
                    && matches!(
                        property.as_ref(),
                        "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
                    )
            }),
        Expression::CallExpression(call) => {
            let Some(function) = ime_resolve_called_function(call, ctx) else {
                return false;
            };
            if !visited_functions.insert(function.id()) {
                return false;
            }
            let result = ime_single_return_expression(function).is_some_and(|returned| {
                ime_expression_requires_modifier(returned, predicate_result, ctx, visited_functions)
            });
            visited_functions.remove(&function.id());
            result
        }
        _ => false,
    }
}

fn ime_scope_uses_space(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            return false;
        };
        if !expression.span().contains_inclusive(candidate.span())
            || ctx
                .nodes()
                .ancestors(candidate.id())
                .take_while(|ancestor| expression.span().contains_inclusive(ancestor.span()))
                .any(|ancestor| matches!(ancestor.kind(), AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot))
        {
            return false;
        }
        matches!(binary.operator, BinaryOperator::Equality | BinaryOperator::StrictEquality)
            && (ime_member_matches_space_value(&binary.left, &binary.right)
                || ime_member_matches_space_value(&binary.right, &binary.left))
    })
}

fn ime_member_matches_space_value(member: &Expression<'_>, value: &Expression<'_>) -> bool {
    let Some(property_name) = member
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member| member.static_property_name())
    else {
        return false;
    };
    match (property_name.as_ref(), value.get_inner_expression()) {
        ("key", Expression::StringLiteral(value)) => {
            matches!(value.value.as_str(), " " | "Spacebar")
        }
        ("keyCode" | "which", Expression::NumericLiteral(value)) => value.value == 32.0,
        _ => false,
    }
}

fn ime_branch_performs_commit(
    action_span: Span,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        action_span.contains_inclusive(candidate.span())
            && ime_nearest_function_id(candidate, ctx) == Some(owner_function_id)
            && !ime_is_non_commit_call(call, ctx)
    })
}

fn ime_is_non_commit_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let callee = call.callee.get_inner_expression();
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    if matches!(
        property_name.as_ref(),
        "preventDefault" | "stopPropagation" | "stopImmediatePropagation"
    ) {
        return true;
    }
    matches!(
        property_name.as_ref(),
        "debug" | "error" | "info" | "log" | "trace" | "warn"
    ) && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "console"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn ime_identifier_has_ime_word(name: &str) -> bool {
    let mut word = String::new();
    let characters: Vec<char> = name.chars().collect();
    for (index, character) in characters.iter().copied().enumerate() {
        if matches!(character, '_' | '-' | '$') {
            if word.eq_ignore_ascii_case("ime") {
                return true;
            }
            word.clear();
            continue;
        }
        let starts_new_word = !word.is_empty()
            && character.is_ascii_uppercase()
            && (characters[index - 1].is_ascii_lowercase()
                || characters[index - 1].is_ascii_digit()
                || characters
                    .get(index + 1)
                    .is_some_and(|next| next.is_ascii_lowercase()));
        if starts_new_word {
            if word.eq_ignore_ascii_case("ime") {
                return true;
            }
            word.clear();
        }
        word.push(character);
    }
    word.eq_ignore_ascii_case("ime")
}

fn ime_subtree_has_composition_signal(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !expression.span().contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::IdentifierReference(identifier) => {
                identifier.name.to_ascii_lowercase().contains("composi")
                    || ime_identifier_has_ime_word(identifier.name.as_str())
            }
            AstKind::StaticMemberExpression(member) => {
                member
                    .property
                    .name
                    .to_ascii_lowercase()
                    .contains("composi")
                    || ime_identifier_has_ime_word(member.property.name.as_str())
            }
            AstKind::ComputedMemberExpression(member) => {
                member.static_property_name().is_some_and(|property| {
                    property.to_ascii_lowercase().contains("composi")
                        || ime_identifier_has_ime_word(property.as_ref())
                })
            }
            AstKind::NumericLiteral(literal) => literal.value == 229.0,
            _ => false,
        }
    })
}

fn ime_merge_composition_state(left: Option<bool>, right: Option<bool>) -> Option<bool> {
    match (left, right) {
        (None, right) => right,
        (left, None) => left,
        (Some(left), Some(right)) if left == right => Some(left),
        _ => None,
    }
}

fn ime_composition_is_active_when_predicate(
    expression: &Expression<'_>,
    predicate_result: bool,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            ime_composition_is_active_when_predicate(&unary.argument, !predicate_result, ctx)
        }
        Expression::LogicalExpression(logical)
            if (logical.operator == LogicalOperator::And && predicate_result)
                || (logical.operator == LogicalOperator::Or && !predicate_result) =>
        {
            Some(ime_merge_composition_state(
                ime_composition_is_active_when_predicate(&logical.left, predicate_result, ctx),
                ime_composition_is_active_when_predicate(&logical.right, predicate_result, ctx),
            )?)
        }
        expression
            if matches!(
                expression,
                Expression::Identifier(_) | Expression::CallExpression(_)
            ) || expression.as_member_expression().is_some() =>
        {
            ime_subtree_has_composition_signal(expression, ctx).then_some(predicate_result)
        }
        Expression::BinaryExpression(binary) => {
            ime_composition_binary_state(binary, predicate_result, ctx)
        }
        _ => None,
    }
}

fn ime_composition_binary_state(
    binary: &BinaryExpression<'_>,
    predicate_result: bool,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    let is_equality = matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    );
    if !is_equality
        && !matches!(
            binary.operator,
            BinaryOperator::Inequality | BinaryOperator::StrictInequality
        )
    {
        return None;
    }
    let keycode_member = |expression: &Expression<'_>| {
        expression
            .get_inner_expression()
            .as_member_expression()
            .and_then(|member| member.static_property_name())
            .is_some_and(|property| matches!(property.as_ref(), "keyCode" | "which"))
    };
    let ime_keycode_value = |expression: &Expression<'_>| match expression.get_inner_expression() {
        Expression::NumericLiteral(value) => value.value == 229.0,
        Expression::Identifier(identifier) => ime_identifier_has_ime_word(identifier.name.as_str()),
        _ => false,
    };
    if (keycode_member(&binary.left) && ime_keycode_value(&binary.right))
        || (keycode_member(&binary.right) && ime_keycode_value(&binary.left))
    {
        return Some(predicate_result == is_equality);
    }
    let (composition_side, value_side) = if ime_subtree_has_composition_signal(&binary.left, ctx) {
        (&binary.left, &binary.right)
    } else if ime_subtree_has_composition_signal(&binary.right, ctx) {
        (&binary.right, &binary.left)
    } else {
        return None;
    };
    let _ = composition_side;
    match value_side.get_inner_expression() {
        Expression::BooleanLiteral(value) => {
            let active_result = if is_equality {
                value.value
            } else {
                !value.value
            };
            Some(predicate_result == active_result)
        }
        Expression::NumericLiteral(value) if value.value == 229.0 => {
            Some(predicate_result == is_equality)
        }
        _ => None,
    }
}

fn ime_has_prior_composition_early_exit(
    boundary_span: Span,
    target_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(mut current) = ctx
        .nodes()
        .iter()
        .find(|candidate| candidate.span() == target_span)
    else {
        return false;
    };
    while current.span() != boundary_span {
        let parent = ctx.nodes().parent_node(current.id());
        if let AstKind::BlockStatement(block) = parent.kind()
            && let Some(current_index) = block
                .body
                .iter()
                .position(|statement| statement.span() == current.span())
        {
            for statement in block.body.iter().take(current_index) {
                let Statement::IfStatement(statement) = statement else {
                    continue;
                };
                if ime_composition_is_active_when_predicate(&statement.test, true, ctx)
                    == Some(true)
                    && ime_statement_terminates_flow(&statement.consequent)
                {
                    return true;
                }
            }
        }
        if !boundary_span.contains_inclusive(parent.span()) {
            return false;
        }
        current = parent;
    }
    false
}

fn ime_statement_terminates_flow(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => {
            block.body.last().is_some_and(ime_statement_terminates_flow)
        }
        _ => false,
    }
}

fn ime_scope_commits_are_composition_guarded(
    scope_span: Span,
    owner_function_id: NodeId,
    visited_functions: &mut FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut found_commit = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if !scope_span.contains_inclusive(candidate.span())
            || ime_nearest_function_id(candidate, ctx) != Some(owner_function_id)
            || ime_is_propagation_call(call)
        {
            continue;
        }
        found_commit = true;
        if ime_is_inside_composition_safe_condition(candidate, scope_span, ctx)
            || ime_has_prior_composition_early_exit(scope_span, candidate.span(), ctx)
        {
            continue;
        }
        if let Some(function) = ime_resolve_called_function(call, ctx)
            && visited_functions.insert(function.id())
        {
            let guarded = ime_scope_commits_are_composition_guarded(
                function.span(),
                function.id(),
                visited_functions,
                ctx,
            );
            visited_functions.remove(&function.id());
            if guarded {
                continue;
            }
        }
        return false;
    }
    found_commit
}

fn ime_is_propagation_call(call: &CallExpression<'_>) -> bool {
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .and_then(|member| member.static_property_name())
        .is_some_and(|property| {
            matches!(
                property.as_ref(),
                "preventDefault" | "stopPropagation" | "stopImmediatePropagation"
            )
        })
}

fn ime_is_inside_composition_safe_condition(
    node: &AstNode<'_>,
    boundary_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.span() == boundary_span {
            break;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let predicate = if statement.consequent.span() == child_span {
                    Some(true)
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == child_span)
                {
                    Some(false)
                } else {
                    None
                };
                if predicate.is_some_and(|predicate| {
                    ime_composition_is_active_when_predicate(&statement.test, predicate, ctx)
                        == Some(false)
                }) {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let predicate = if expression.consequent.span() == child_span {
                    Some(true)
                } else if expression.alternate.span() == child_span {
                    Some(false)
                } else {
                    None
                };
                if predicate.is_some_and(|predicate| {
                    ime_composition_is_active_when_predicate(&expression.test, predicate, ctx)
                        == Some(false)
                }) {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                let predicate = match expression.operator {
                    LogicalOperator::And => Some(true),
                    LogicalOperator::Or => Some(false),
                    _ => None,
                };
                if predicate.is_some_and(|predicate| {
                    ime_composition_is_active_when_predicate(&expression.left, predicate, ctx)
                        == Some(false)
                }) {
                    return true;
                }
            }
            AstKind::WhileStatement(statement) if statement.body.span() == child_span => {
                if ime_composition_is_active_when_predicate(&statement.test, true, ctx)
                    == Some(false)
                {
                    return true;
                }
            }
            AstKind::DoWhileStatement(statement) if statement.body.span() == child_span => {
                if ime_composition_is_active_when_predicate(&statement.test, true, ctx)
                    == Some(false)
                {
                    return true;
                }
            }
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn ime_resolve_called_function<'a, 'b>(
    call: &CallExpression<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(_) = callee {
        return ime_resolve_function_expression(callee, ctx);
    }
    let Expression::StaticMemberExpression(member) = callee else {
        return None;
    };
    if !matches!(
        member.object.get_inner_expression(),
        Expression::ThisExpression(_)
    ) {
        return None;
    }
    let member_name = member.property.name.as_str();
    let class_body_span = ctx
        .nodes()
        .iter()
        .filter(|candidate| matches!(candidate.kind(), AstKind::ClassBody(_)))
        .find(|candidate| candidate.span().contains_inclusive(call.span))?
        .span();
    for candidate in ctx.nodes().iter() {
        if !class_body_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::MethodDefinition(method)
                if method.key.static_name().as_deref() == Some(member_name) =>
            {
                return Some(ctx.nodes().get_node(method.value.node_id.get()));
            }
            AstKind::PropertyDefinition(property)
                if property.key.static_name().as_deref() == Some(member_name) =>
            {
                return ime_resolve_function_expression(property.value.as_ref()?, ctx);
            }
            _ => {}
        }
    }
    None
}

fn ime_single_return_expression<'a, 'b>(function: &'b AstNode<'a>) -> Option<&'b Expression<'a>> {
    let statements = match function.kind() {
        AstKind::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return Some(expression);
            }
            function.get_function_body()?.statements.as_slice()
        }
        AstKind::Function(function) => function.body.as_ref()?.statements.as_slice(),
        _ => return None,
    };
    let [Statement::ReturnStatement(statement)] = statements else {
        return None;
    };
    statement.argument.as_ref()
}
