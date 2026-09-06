use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, FormalParameter, JSXAttributeName, MemberExpression,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DEPRECATED_NUMERIC_MEMBERS: [&str; 3] = ["keyCode", "which", "charCode"];
const KEYBOARD_LISTENER_EVENTS: [&str; 3] = ["keydown", "keyup", "keypress"];
const LAYOUT_INVARIANT_CONTROL_KEYCODES: [i32; 37] = [
    8, 9, 13, 16, 17, 18, 19, 20, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46, 91, 92, 93,
    112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 144, 145,
];
const LEGACY_IME_KEYCODES: [i32; 2] = [0, 229];
const MAX_RELATIONAL_RANGE_SPAN: f64 = 100.0;
const MOUSE_BUTTON_LITERALS: [i32; 4] = [1, 2, 3, 4];
const MOUSE_BUTTON_MEMBERS: [&str; 2] = ["button", "buttons"];
const STANDARD_KEY_MEMBERS: [&str; 2] = ["key", "code"];
const MESSAGE: &str = "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated, and this comparison targets a character code that varies by keyboard layout, browser, and input method, so the branch fires on the wrong key (or never) for untested layouts. Branch on the standardized `event.key` (logical key) or `event.code` (physical key) instead.";

#[derive(Debug, Default, Clone)]
pub struct NoDeprecatedKeyboardEventKeycodeWhich;

declare_oxc_lint!(
    /// Disallow layout-sensitive branching on deprecated numeric keyboard event members.
    NoDeprecatedKeyboardEventKeycodeWhich,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow layout-sensitive deprecated keyboard event comparisons.",
);

impl Rule for NoDeprecatedKeyboardEventKeycodeWhich {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_source_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some((receiver, property_name, diagnostic_span)) = deprecated_keyboard_member(node)
        else {
            return;
        };
        let branching_context = resolve_keyboard_branching_context(node, ctx);
        if !branching_context.is_branching {
            return;
        }
        let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(handler) = keyboard_handler_info(function_node, ctx) else {
            return;
        };
        let Some(receiver_symbol_id) = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
        else {
            return;
        };
        if receiver_symbol_id != handler.parameter_symbol_id
            || receiver.name != handler.parameter_name
        {
            return;
        }
        match handler.parameter_type {
            KeyboardParameterType::OtherReference => return,
            KeyboardParameterType::Unknown if !function_is_keyboard_handler(function_node, ctx) => {
                return;
            }
            KeyboardParameterType::KeyboardEvent | KeyboardParameterType::Unknown => {}
        }

        let comparison = keyboard_comparison(node, ctx);
        let compared_value = comparison.as_ref().and_then(|comparison| comparison.compared_value);
        if compared_value.is_some_and(|value| value_is_in_integer_set(value, &LEGACY_IME_KEYCODES))
        {
            return;
        }
        if property_name == "which"
            && compared_value
                .is_some_and(|value| value_is_in_integer_set(value, &MOUSE_BUTTON_LITERALS))
        {
            return;
        }
        if property_name == "which"
            && receiver_reads_property(
                function_node,
                handler.parameter_symbol_id,
                &MOUSE_BUTTON_MEMBERS,
                ctx,
                None,
                false,
            )
        {
            return;
        }
        if receiver_reads_property(
            function_node,
            handler.parameter_symbol_id,
            &STANDARD_KEY_MEMBERS,
            ctx,
            Some(branching_context.condition_root),
            true,
        ) || receiver_destructures_standard_property(
            function_node,
            handler.parameter_symbol_id,
            branching_context.condition_root,
            ctx,
        ) || receiver_feature_detects_standard_property(
            function_node,
            handler.parameter_symbol_id,
            branching_context.condition_root,
            ctx,
        ) {
            return;
        }

        if property_name != "charCode" {
            let is_relational_range_check = comparison.as_ref().is_some_and(|comparison| {
                is_relational_operator(comparison.operator)
                    && !relational_range_is_layout_invariant(
                        node,
                        handler.parameter_symbol_id,
                        property_name,
                        ctx,
                    )
            });
            let compares_layout_sensitive_code =
                compared_value.is_some_and(is_layout_sensitive_code);
            let switches_on_layout_sensitive_code = switch_targets_layout_sensitive_code(
                branching_context.condition_root,
                ctx,
            );
            if !is_relational_range_check
                && !compares_layout_sensitive_code
                && !switches_on_layout_sensitive_code
            {
                return;
            }
        }

        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
    }
}

struct KeyboardHandlerInfo<'a> {
    parameter_name: &'a str,
    parameter_symbol_id: SymbolId,
    parameter_type: KeyboardParameterType,
}

enum KeyboardParameterType {
    KeyboardEvent,
    OtherReference,
    Unknown,
}

struct KeyboardBranchingContext<'a, 'b> {
    condition_root: &'b AstNode<'a>,
    is_branching: bool,
    climbed_through_logical: bool,
}

struct KeyboardComparison {
    operator: BinaryOperator,
    compared_value: Option<f64>,
}

fn deprecated_keyboard_member<'a>(
    node: &AstNode<'a>,
) -> Option<(&'a oxc_ast::ast::IdentifierReference<'a>, &'a str, Span)> {
    let (object, property_name, span) = match node.kind() {
        AstKind::StaticMemberExpression(member_expression) => (
            &member_expression.object,
            member_expression.property.name.as_str(),
            member_expression.span,
        ),
        AstKind::ComputedMemberExpression(member_expression) => {
            let Expression::StringLiteral(property) = &member_expression.expression else {
                return None;
            };
            (
                &member_expression.object,
                property.value.as_str(),
                member_expression.span,
            )
        }
        _ => return None,
    };
    if !DEPRECATED_NUMERIC_MEMBERS.contains(&property_name) {
        return None;
    }
    let Expression::Identifier(receiver) = object else {
        return None;
    };
    Some((receiver, property_name, span))
}

fn keyboard_handler_info<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<KeyboardHandlerInfo<'a>> {
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let parameter = parameters.items.first()?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(KeyboardHandlerInfo {
        parameter_name: identifier.name.as_str(),
        parameter_symbol_id: identifier.symbol_id(),
        parameter_type: keyboard_parameter_type(parameter, ctx),
    })
}

fn keyboard_parameter_type(
    parameter: &FormalParameter<'_>,
    ctx: &LintContext<'_>,
) -> KeyboardParameterType {
    let source = ctx.source_range(parameter.span());
    let Some((_, type_source)) = source.split_once(':') else {
        return KeyboardParameterType::Unknown;
    };
    let type_source = type_source
        .split_once('=')
        .map_or(type_source, |(annotation, _)| annotation)
        .trim();
    let type_name = type_source
        .split_once('<')
        .map_or(type_source, |(name, _)| name)
        .trim();
    if type_name.is_empty()
        || type_name.split('.').any(|segment| {
            segment.is_empty()
                || !segment.chars().enumerate().all(|(index, character)| {
                    character == '_'
                        || character == '$'
                        || if index == 0 {
                            character.is_alphabetic()
                        } else {
                            character.is_alphanumeric()
                        }
                })
        })
    {
        return KeyboardParameterType::Unknown;
    }
    if type_name.rsplit('.').next() == Some("KeyboardEvent") {
        KeyboardParameterType::KeyboardEvent
    } else {
        KeyboardParameterType::OtherReference
    }
}

fn function_is_keyboard_handler<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
        && function
            .id
            .as_ref()
            .is_some_and(|identifier| name_looks_like_keyboard_handler(identifier.name.as_str()))
    {
        return true;
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| name_looks_like_keyboard_handler(identifier.name.as_str())),
        AstKind::ObjectProperty(property) => property_key_identifier_name(&property.key)
            .is_some_and(name_looks_like_keyboard_handler),
        AstKind::PropertyDefinition(property) => property_key_identifier_name(&property.key)
            .is_some_and(name_looks_like_keyboard_handler),
        AstKind::MethodDefinition(method) => property_key_identifier_name(&method.key)
            .is_some_and(name_looks_like_keyboard_handler),
        AstKind::AssignmentExpression(assignment) => {
            let Some(MemberExpression::StaticMemberExpression(member)) =
                assignment.left.as_member_expression()
            else {
                return false;
            };
            name_looks_like_keyboard_handler(member.property.name.as_str())
        }
        AstKind::JSXExpressionContainer(_) => {
            let attribute = ctx.nodes().parent_node(parent.id());
            matches!(
                attribute.kind(),
                AstKind::JSXAttribute(attribute) if match &attribute.name {
                    JSXAttributeName::Identifier(identifier) => identifier
                        .name
                        .to_ascii_lowercase()
                        .starts_with("onkey"),
                    JSXAttributeName::NamespacedName(namespaced) => namespaced
                        .namespace
                        .name
                        .to_ascii_lowercase()
                        .starts_with("onkey"),
                }
            )
        }
        AstKind::CallExpression(call) => {
            call.arguments.get(1).is_some_and(|argument| {
                argument.span() == function_node.span()
            }) && matches!(
                &call.callee,
                Expression::StaticMemberExpression(member)
                    if member.property.name == "addEventListener"
            )
                && call.arguments.first().is_some_and(|argument| {
                    matches!(
                        argument,
                        Argument::StringLiteral(event)
                            if KEYBOARD_LISTENER_EVENTS.contains(&event.value.as_str())
                    )
                })
        }
        _ => false,
    }
}

fn name_looks_like_keyboard_handler(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["keydown", "keyup", "keypress"]
        .iter()
        .any(|fragment| name.contains(fragment))
}

fn resolve_keyboard_branching_context<'a, 'b>(
    member_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> KeyboardBranchingContext<'a, 'b> {
    let mut node = transparent_expression_root(member_node, ctx);
    let mut climbed_through_comparison = false;
    let mut climbed_through_logical = false;
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        let should_climb = match parent.kind() {
            AstKind::UnaryExpression(_) => true,
            AstKind::LogicalExpression(_) => {
                climbed_through_logical = true;
                true
            }
            AstKind::BinaryExpression(binary) if is_comparison_operator(binary.operator) => {
                climbed_through_comparison = true;
                true
            }
            _ => false,
        };
        if !should_climb {
            break;
        }
        node = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(node.id());
    let is_test_or_discriminant = match parent.kind() {
        AstKind::SwitchStatement(statement) => statement.discriminant.span() == node.span(),
        AstKind::IfStatement(statement) => statement.test.span() == node.span(),
        AstKind::ConditionalExpression(expression) => expression.test.span() == node.span(),
        AstKind::WhileStatement(statement) => statement.test.span() == node.span(),
        AstKind::DoWhileStatement(statement) => statement.test.span() == node.span(),
        _ => false,
    };
    KeyboardBranchingContext {
        condition_root: node,
        is_branching: climbed_through_comparison || is_test_or_discriminant,
        climbed_through_logical,
    }
}

fn keyboard_comparison<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<KeyboardComparison> {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::BinaryExpression(binary) = parent.kind() else {
        return None;
    };
    if !is_comparison_operator(binary.operator) {
        return None;
    }
    let other_operand = if binary.left.span() == expression_root.span() {
        &binary.right
    } else {
        &binary.left
    };
    Some(KeyboardComparison {
        operator: binary.operator,
        compared_value: resolve_keyboard_numeric_value(other_operand, ctx),
    })
}

fn resolve_keyboard_numeric_value(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<f64> {
    match strip_parenthesized_expression(expression) {
        Expression::NumericLiteral(number) => Some(number.value),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(
                parent.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) {
                return None;
            }
            let Expression::NumericLiteral(number) = declarator.init.as_ref()? else {
                return None;
            };
            Some(number.value)
        }
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn receiver_reads_property<'a>(
    function_node: &AstNode<'a>,
    receiver_symbol_id: SymbolId,
    property_names: &[&str],
    ctx: &LintContext<'a>,
    fallback_condition_root: Option<&AstNode<'a>>,
    must_feed_logic: bool,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !node_belongs_to_function(candidate, function_node, ctx) {
            return false;
        }
        let AstKind::StaticMemberExpression(member) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(receiver) = &member.object else {
            return false;
        };
        if !property_names.contains(&member.property.name.as_str())
            || ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                != Some(receiver_symbol_id)
            || must_feed_logic && !keyboard_read_feeds_logic(candidate, ctx)
        {
            return false;
        }
        fallback_condition_root.is_none_or(|fallback| {
            standard_read_controls_fallback(candidate, fallback, ctx)
        })
    })
}

fn receiver_destructures_standard_property<'a>(
    function_node: &AstNode<'a>,
    receiver_symbol_id: SymbolId,
    fallback_condition_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !node_belongs_to_function(candidate, function_node, ctx) {
            return false;
        }
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            return false;
        };
        let Some(Expression::Identifier(initializer)) =
            declarator.init.as_ref().map(strip_parenthesized_expression)
        else {
            return false;
        };
        if ctx
            .scoping()
            .get_reference(initializer.reference_id())
            .symbol_id()
            != Some(receiver_symbol_id)
        {
            return false;
        }
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return false;
        };
        pattern.properties.iter().any(|property| {
            if property
                .key
                .static_name()
                .is_none_or(|name| !STANDARD_KEY_MEMBERS.contains(&name.as_ref()))
            {
                return false;
            }
            let Some(binding) = property.value.get_binding_identifier() else {
                return false;
            };
            ctx.scoping()
                .get_resolved_references(binding.symbol_id())
                .any(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    keyboard_read_feeds_logic(reference_node, ctx)
                        && direct_logic_controls_fallback(
                            reference_node,
                            fallback_condition_root,
                            ctx,
                        )
                })
        })
    })
}

fn receiver_feature_detects_standard_property<'a>(
    function_node: &AstNode<'a>,
    receiver_symbol_id: SymbolId,
    fallback_condition_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !node_belongs_to_function(candidate, function_node, ctx) {
            return false;
        }
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            return false;
        };
        let Expression::StringLiteral(property) = &binary.left else {
            return false;
        };
        let Expression::Identifier(receiver) = &binary.right else {
            return false;
        };
        binary.operator == BinaryOperator::In
            && STANDARD_KEY_MEMBERS.contains(&property.value.as_str())
            && ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                == Some(receiver_symbol_id)
            && keyboard_read_feeds_logic(candidate, ctx)
            && direct_logic_controls_fallback(candidate, fallback_condition_root, ctx)
    })
}

fn standard_read_controls_fallback<'a>(
    read_node: &AstNode<'a>,
    fallback_condition_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if direct_logic_controls_fallback(read_node, fallback_condition_root, ctx) {
        return true;
    }
    let value_root = keyboard_read_value_root(read_node, ctx);
    let parent = ctx.nodes().parent_node(value_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != value_root.span())
    {
        return false;
    }
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(binding.symbol_id())
        .any(|reference| {
            direct_logic_controls_fallback(
                ctx.nodes().get_node(reference.node_id()),
                fallback_condition_root,
                ctx,
            )
        })
}

fn keyboard_read_feeds_logic<'a>(
    read_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let value_root = keyboard_read_value_root(read_node, ctx);
    let branching_context = resolve_keyboard_branching_context(value_root, ctx);
    if branching_context.is_branching || branching_context.climbed_through_logical {
        return true;
    }
    let parent = ctx.nodes().parent_node(branching_context.condition_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(_)
        | AstKind::AssignmentExpression(_)
        | AstKind::ReturnStatement(_) => true,
        AstKind::CallExpression(call)
            if call.callee.span() != branching_context.condition_root.span() =>
        {
            keyboard_read_feeds_logic(parent, ctx)
        }
        _ => false,
    }
}

fn keyboard_read_value_root<'a, 'b>(
    read_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut current = transparent_expression_root(read_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let should_climb = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span() == current.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span() == current.span(),
            AstKind::CallExpression(call) => call.callee.span() == current.span(),
            _ => false,
        };
        if !should_climb {
            return current;
        }
        current = transparent_expression_root(parent, ctx);
    }
}

fn direct_logic_controls_fallback<'a>(
    signal_node: &AstNode<'a>,
    fallback_condition_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if fallback_condition_root
        .span()
        .contains_inclusive(signal_node.span())
    {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(signal_node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        match ancestor.kind() {
            AstKind::LogicalExpression(_)
                if ancestor
                    .span()
                    .contains_inclusive(fallback_condition_root.span()) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if ancestor
                    .span()
                    .contains_inclusive(fallback_condition_root.span())
                    && (expression.test.span().contains_inclusive(signal_node.span())
                        || expression
                            .consequent
                            .span()
                            .contains_inclusive(signal_node.span())) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if statement.test.span().contains_inclusive(signal_node.span()) =>
            {
                if statement.alternate.as_ref().is_some_and(|alternate| {
                    alternate
                        .span()
                        .contains_inclusive(fallback_condition_root.span())
                }) {
                    return true;
                }
                if statement_always_exits(&statement.consequent)
                    && fallback_follows_if_in_same_block(
                        statement,
                        fallback_condition_root,
                        ancestor,
                        ctx,
                    )
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn fallback_follows_if_in_same_block<'a>(
    if_statement: &oxc_ast::ast::IfStatement<'a>,
    fallback_condition_root: &AstNode<'a>,
    if_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let block_node = ctx.nodes().parent_node(if_node.id());
    let AstKind::BlockStatement(block) = block_node.kind() else {
        return false;
    };
    let signal_index = block
        .body
        .iter()
        .position(|statement| statement.span() == if_statement.span);
    let fallback_index = block.body.iter().position(|statement| {
        statement
            .span()
            .contains_inclusive(fallback_condition_root.span())
    });
    signal_index.zip(fallback_index).is_some_and(|(signal, fallback)| {
        fallback > signal
    })
}

fn switch_targets_layout_sensitive_code<'a>(
    condition_root: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(condition_root.id());
    let AstKind::SwitchStatement(statement) = parent.kind() else {
        return false;
    };
    if statement.discriminant.span() != condition_root.span() {
        return false;
    }
    statement.cases.iter().any(|case| {
        case.test
            .as_ref()
            .and_then(|test| resolve_keyboard_numeric_value(test, ctx))
            .is_some_and(is_layout_sensitive_code)
    })
}

fn relational_range_is_layout_invariant<'a>(
    member_node: &AstNode<'a>,
    receiver_symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(member_node, ctx);
    let comparison_node = ctx.nodes().parent_node(expression_root.id());
    if !matches!(comparison_node.kind(), AstKind::BinaryExpression(_)) {
        return false;
    }
    let mut logical_root = comparison_node;
    loop {
        let parent = ctx.nodes().parent_node(logical_root.id());
        let AstKind::LogicalExpression(logical) = parent.kind() else {
            break;
        };
        if logical.operator != LogicalOperator::And {
            return false;
        }
        logical_root = parent;
    }
    let mut lower_bound: Option<f64> = None;
    let mut upper_bound: Option<f64> = None;
    for candidate in ctx.nodes().iter() {
        if !logical_root.span().contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            continue;
        };
        if !is_relational_operator(binary.operator) {
            continue;
        }
        let (operator, value_expression) = if keyboard_expression_matches_member(
            &binary.left,
            receiver_symbol_id,
            property_name,
            ctx,
        ) {
            (binary.operator, &binary.right)
        } else if keyboard_expression_matches_member(
            &binary.right,
            receiver_symbol_id,
            property_name,
            ctx,
        ) {
            (reverse_relational_operator(binary.operator), &binary.left)
        } else {
            continue;
        };
        let Some(value) = resolve_keyboard_numeric_value(value_expression, ctx) else {
            continue;
        };
        match operator {
            BinaryOperator::GreaterEqualThan => {
                lower_bound = Some(lower_bound.map_or(value, |current| current.max(value)));
            }
            BinaryOperator::GreaterThan => {
                lower_bound = Some(lower_bound.map_or(value + 1.0, |current| current.max(value + 1.0)));
            }
            BinaryOperator::LessEqualThan => {
                upper_bound = Some(upper_bound.map_or(value, |current| current.min(value)));
            }
            BinaryOperator::LessThan => {
                upper_bound = Some(upper_bound.map_or(value - 1.0, |current| current.min(value - 1.0)));
            }
            _ => {}
        }
    }
    let Some((lower_bound, upper_bound)) = lower_bound.zip(upper_bound) else {
        return false;
    };
    if upper_bound < lower_bound || upper_bound - lower_bound > MAX_RELATIONAL_RANGE_SPAN {
        return false;
    }
    let mut code = lower_bound;
    while code <= upper_bound {
        if is_layout_sensitive_code(code) {
            return false;
        }
        code += 1.0;
    }
    true
}

fn keyboard_expression_matches_member(
    expression: &Expression<'_>,
    receiver_symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::StaticMemberExpression(member) = strip_parenthesized_expression(expression)
    else {
        return false;
    };
    let Expression::Identifier(receiver) = &member.object else {
        return false;
    };
    member.property.name == property_name
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            == Some(receiver_symbol_id)
}

fn node_belongs_to_function<'a>(
    node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    crate::ast_util::get_enclosing_function(node, ctx)
        .is_some_and(|owner| owner.id() == function_node.id())
}

fn is_comparison_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
            | BinaryOperator::LessThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterEqualThan
    )
}

fn is_relational_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::LessThan
            | BinaryOperator::GreaterThan
            | BinaryOperator::LessEqualThan
            | BinaryOperator::GreaterEqualThan
    )
}

fn reverse_relational_operator(operator: BinaryOperator) -> BinaryOperator {
    match operator {
        BinaryOperator::LessThan => BinaryOperator::GreaterThan,
        BinaryOperator::GreaterThan => BinaryOperator::LessThan,
        BinaryOperator::LessEqualThan => BinaryOperator::GreaterEqualThan,
        BinaryOperator::GreaterEqualThan => BinaryOperator::LessEqualThan,
        _ => operator,
    }
}

fn is_layout_sensitive_code(value: f64) -> bool {
    !value_is_in_integer_set(value, &LEGACY_IME_KEYCODES)
        && !value_is_in_integer_set(value, &LAYOUT_INVARIANT_CONTROL_KEYCODES)
}

fn value_is_in_integer_set(value: f64, values: &[i32]) -> bool {
    value.fract() == 0.0 && values.contains(&(value as i32))
}
