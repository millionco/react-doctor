use oxc_ast::{
    AstKind,
    ast::{Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Multiplying or dividing an optional-chained value yields NaN when the chain short-circuits to undefined, and NaN spreads silently into formatting and comparisons. Add a `?? fallback` or guard the value before the math.";

#[derive(Debug, Default, Clone)]
pub struct NoArithmeticOnOptionalChainedOperand;

declare_oxc_lint!(
    /// Warns when multiplicative arithmetic consumes an optional-chain value.
    NoArithmeticOnOptionalChainedOperand,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Multiplicative math on optional-chained value can be NaN.",
);

impl Rule for NoArithmeticOnOptionalChainedOperand {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::BinaryExpression(binary) = node.kind() else {
            return;
        };
        if !matches!(
            binary.operator,
            BinaryOperator::Multiplication | BinaryOperator::Division | BinaryOperator::Remainder
        ) {
            return;
        }
        for operand in [&binary.left, &binary.right] {
            let Some(guard_subjects) = optional_operand_guard_subjects(operand, ctx) else {
                continue;
            };
            if is_guarded_at_node(node, &guard_subjects, ctx)
                || is_discarded_before_first_binding_use(node, &guard_subjects, ctx)
                || !flows_into_numeric_consumer(node, &guard_subjects, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(binary.span));
            return;
        }
    }
}

fn optional_operand_guard_subjects<'a>(
    operand: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<Vec<String>> {
    if is_direct_optional_chain_member(operand) {
        return optional_guard_subject(ctx.source_range(operand.span())).map(|subject| {
            let mut subjects = vec![subject];
            subjects.extend(same_chain_alias_subjects(operand, ctx));
            subjects
        });
    }
    let Expression::Identifier(identifier) = operand.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    let initializer = declarator.init.as_ref()?;
    if !is_direct_optional_chain_member(initializer) {
        return None;
    }
    let mut subjects = vec![identifier.name.to_string()];
    if let Some(subject) = optional_guard_subject(ctx.source_range(initializer.span())) {
        subjects.push(subject);
    }
    Some(subjects)
}

fn same_chain_alias_subjects(operand: &Expression<'_>, ctx: &LintContext<'_>) -> Vec<String> {
    let operand_source = normalized_expression_source(ctx.source_range(operand.span()));
    let operand_owner = ctx
        .nodes()
        .iter()
        .find(|candidate| candidate.span() == operand.span())
        .and_then(|operand_node| function_owner_id(operand_node, ctx));
    ctx.scoping()
        .symbol_ids()
        .filter_map(|symbol_id| {
            let declaration = ctx.symbol_declaration(symbol_id);
            if declaration.span().start >= operand.span().start
                || function_owner_id(declaration, ctx) != operand_owner
            {
                return None;
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let binding = declarator.id.get_binding_identifier()?;
            let initializer = declarator.init.as_ref()?;
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || !is_direct_optional_chain_member(initializer)
                || normalized_expression_source(ctx.source_range(initializer.span()))
                    != operand_source
            {
                return None;
            }
            Some(binding.name.to_string())
        })
        .collect()
}

fn function_owner_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<oxc_semantic::NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
            )
        })
        .map(AstNode::id)
}

fn is_direct_optional_chain_member(expression: &Expression<'_>) -> bool {
    let mut current = expression;
    loop {
        match current {
            Expression::ParenthesizedExpression(wrapper) => current = &wrapper.expression,
            Expression::TSAsExpression(wrapper) => current = &wrapper.expression,
            Expression::TSSatisfiesExpression(wrapper) => current = &wrapper.expression,
            Expression::TSTypeAssertion(wrapper) => current = &wrapper.expression,
            Expression::TSInstantiationExpression(wrapper) => current = &wrapper.expression,
            Expression::TSNonNullExpression(wrapper) => current = &wrapper.expression,
            Expression::ChainExpression(chain) => {
                return chain
                    .expression
                    .as_member_expression()
                    .is_some_and(|member| !member.is_computed());
            }
            _ => return false,
        }
    }
}

fn optional_guard_subject(source: &str) -> Option<String> {
    let compact = normalized_expression_source(source);
    let (prefix, _) = compact.rsplit_once("?.")?;
    let normalized_prefix = prefix.replace("?.", ".");
    let subject = normalized_prefix
        .trim_start_matches('(')
        .trim_start_matches("typeof")
        .trim_matches('(')
        .trim_matches(')');
    (!subject.is_empty()).then(|| subject.to_string())
}

fn flows_into_numeric_consumer(
    binary_node: &AstNode<'_>,
    guard_subjects: &[String],
    ctx: &LintContext<'_>,
) -> bool {
    if is_direct_numeric_consumer(binary_node, false, ctx) {
        return true;
    }
    let mut current = binary_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if is_transparent_wrapper(parent) {
            current = parent;
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            return false;
        };
        if declarator
            .init
            .as_ref()
            .is_none_or(|initializer| initializer.span() != current.span())
        {
            return false;
        }
        let Some(binding) = declarator.id.get_binding_identifier() else {
            return false;
        };
        let symbol_id = binding.symbol_id();
        let mut consumer_offsets = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .filter_map(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                if reference_node.span().start <= binary_node.span().end
                    || !is_direct_numeric_consumer(reference_node, true, ctx)
                {
                    return None;
                }
                let mut consumer_guard_subjects = guard_subjects.to_vec();
                consumer_guard_subjects.push(binding.name.to_string());
                if is_guarded_at_node(reference_node, &consumer_guard_subjects, ctx)
                    || binding_is_nan_clamped_before(
                        symbol_id,
                        binary_node.span().end,
                        reference_node.span().start,
                        ctx,
                    )
                {
                    return None;
                }
                Some(reference_node.span().start)
            })
            .collect::<Vec<_>>();
        consumer_offsets.sort_unstable();
        return !consumer_offsets.is_empty();
    }
}

fn is_direct_numeric_consumer(
    value_node: &AstNode<'_>,
    test_comparison_is_guard: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = value_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if is_transparent_wrapper(parent) {
            current = parent;
            continue;
        }
        return match parent.kind() {
            AstKind::ReturnStatement(statement) => statement
                .argument
                .as_ref()
                .is_some_and(|argument| argument.span() == current.span()),
            AstKind::StaticMemberExpression(member) if member.object.span() == current.span() => {
                matches!(
                    member.property.name.as_str(),
                    "toFixed" | "toString" | "toPrecision" | "toLocaleString"
                )
            }
            AstKind::ComputedMemberExpression(member) if member.object.span() == current.span() => {
                matches!(
                    member.static_property_name().as_deref(),
                    Some("toFixed" | "toString" | "toPrecision" | "toLocaleString")
                )
            }
            AstKind::BinaryExpression(comparison)
                if comparison.left.span() == current.span()
                    || comparison.right.span() == current.span() =>
            {
                matches!(
                    comparison.operator,
                    BinaryOperator::LessThan
                        | BinaryOperator::GreaterThan
                        | BinaryOperator::LessEqualThan
                        | BinaryOperator::GreaterEqualThan
                        | BinaryOperator::Inequality
                        | BinaryOperator::StrictInequality
                ) && (!test_comparison_is_guard || !is_comparison_in_test_position(parent, ctx))
            }
            AstKind::CallExpression(call) => {
                is_global_math_call(call, ctx)
                    && call.arguments.iter().any(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|argument| argument.span() == current.span())
                    })
            }
            _ => false,
        };
    }
}

fn is_global_math_call(call: &oxc_ast::ast::CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Math" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn is_comparison_in_test_position(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::LogicalExpression(_) => current = parent,
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                current = parent;
            }
            AstKind::IfStatement(statement) => return statement.test.span() == current.span(),
            AstKind::ConditionalExpression(expression) => {
                return expression.test.span() == current.span();
            }
            AstKind::WhileStatement(statement) => return statement.test.span() == current.span(),
            AstKind::DoWhileStatement(statement) => return statement.test.span() == current.span(),
            AstKind::ForStatement(statement) => {
                return statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span() == current.span());
            }
            AstKind::JSXExpressionContainer(_) => return true,
            _ => return false,
        }
    }
}

fn is_guarded_at_node(
    node: &AstNode<'_>,
    guard_subjects: &[String],
    ctx: &LintContext<'_>,
) -> bool {
    let mut child = node;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        let enclosing_test =
            match ancestor.kind() {
                AstKind::IfStatement(statement)
                    if statement.consequent.span().contains_inclusive(child.span()) =>
                {
                    Some(statement.test.span())
                }
                AstKind::IfStatement(statement)
                    if statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(child.span())
                    }) && negative_test_references_subjects(
                        ctx.source_range(statement.test.span()),
                        guard_subjects,
                    ) =>
                {
                    return true;
                }
                AstKind::ConditionalExpression(expression)
                    if expression
                        .consequent
                        .span()
                        .contains_inclusive(child.span()) =>
                {
                    Some(expression.test.span())
                }
                AstKind::ConditionalExpression(expression)
                    if expression.alternate.span().contains_inclusive(child.span())
                        && negative_test_references_subjects(
                            ctx.source_range(expression.test.span()),
                            guard_subjects,
                        ) =>
                {
                    return true;
                }
                AstKind::LogicalExpression(expression)
                    if expression.operator == LogicalOperator::And
                        && expression.right.span().contains_inclusive(child.span()) =>
                {
                    Some(expression.left.span())
                }
                _ => None,
            };
        if enclosing_test.is_some_and(|span| {
            positive_test_references_subjects(ctx.source_range(span), guard_subjects)
                && !source_writes_guard_subject(
                    &ctx.source_text()[span.end as usize..node.span().start as usize],
                    guard_subjects,
                )
        }) {
            return true;
        }
        if let AstKind::SwitchCase(switch_case) = ancestor.kind()
            && switch_case.test.is_some()
        {
            let switch_statement = ctx.nodes().parent_node(ancestor.id());
            if let AstKind::SwitchStatement(switch_statement) = switch_statement.kind()
                && source_references_guard_subject(
                    ctx.source_range(switch_statement.discriminant.span()),
                    guard_subjects,
                )
                && !switch_path_writes_before_node(
                    switch_case,
                    node,
                    guard_subjects,
                    switch_statement,
                    ctx,
                )
            {
                return true;
            }
        }
        if let AstKind::BlockStatement(block) = ancestor.kind() {
            for statement in &block.body {
                if statement.span().start >= child.span().start {
                    break;
                }
                if let Statement::IfStatement(statement) = statement
                    && ((statement.alternate.is_none()
                        && statement_always_exits(&statement.consequent)
                        && negative_test_references_subjects(
                            ctx.source_range(statement.test.span()),
                            guard_subjects,
                        ))
                        || (statement
                            .alternate
                            .as_ref()
                            .is_some_and(statement_always_exits)
                            && positive_test_references_subjects(
                                ctx.source_range(statement.test.span()),
                                guard_subjects,
                            )))
                    && !source_writes_guard_subject(
                        &ctx.source_text()
                            [statement.span().end as usize..node.span().start as usize],
                        guard_subjects,
                    )
                {
                    return true;
                }
            }
        }
        child = ancestor;
    }
    false
}

fn is_discarded_before_first_binding_use(
    node: &AstNode<'_>,
    guard_subjects: &[String],
    ctx: &LintContext<'_>,
) -> bool {
    let Some(variable_declaration_node) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(ancestor.kind(), AstKind::VariableDeclaration(_))
            || matches!(ancestor.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_))
    }) else {
        return false;
    };
    let AstKind::VariableDeclaration(variable_declaration) = variable_declaration_node.kind()
    else {
        return false;
    };
    let block_node = ctx.nodes().parent_node(variable_declaration_node.id());
    let AstKind::BlockStatement(block) = block_node.kind() else {
        return false;
    };
    let symbol_ids = variable_declaration
        .declarations
        .iter()
        .filter_map(|declarator| declarator.id.get_binding_identifier())
        .map(|identifier| identifier.symbol_id())
        .collect::<Vec<_>>();
    if symbol_ids.is_empty() {
        return false;
    }
    let first_reference_offset = symbol_ids
        .iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(*symbol_id))
        .map(|reference| ctx.nodes().get_node(reference.node_id()).span().start)
        .filter(|offset| *offset > variable_declaration_node.span().end)
        .min();
    let Some(declaration_index) = block
        .body
        .iter()
        .position(|statement| statement.span().contains_inclusive(variable_declaration_node.span()))
    else {
        return false;
    };
    for following in block.body.iter().skip(declaration_index + 1) {
        if first_reference_offset.is_some_and(|offset| offset < following.span().start) {
            return false;
        }
        let Statement::IfStatement(statement) = following else {
            continue;
        };
        if first_reference_offset.is_some_and(|offset| offset <= statement.span.end) {
            return false;
        }
        if (statement_always_exits(&statement.consequent)
            && negative_test_references_subjects(
                ctx.source_range(statement.test.span()),
                guard_subjects,
            ))
            || (statement
                .alternate
                .as_ref()
                .is_some_and(statement_always_exits)
                && positive_test_references_subjects(
                    ctx.source_range(statement.test.span()),
                    guard_subjects,
                ))
        {
            return true;
        }
    }
    false
}

fn switch_path_writes_before_node(
    current_case: &oxc_ast::ast::SwitchCase<'_>,
    node: &AstNode<'_>,
    guard_subjects: &[String],
    switch_statement: &oxc_ast::ast::SwitchStatement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let current_case_source =
        &ctx.source_text()[current_case.span.start as usize..node.span().start as usize];
    if source_writes_guard_subject(current_case_source, guard_subjects) {
        return true;
    }
    let Some(current_index) = switch_statement
        .cases
        .iter()
        .position(|candidate| candidate.span == current_case.span)
    else {
        return false;
    };
    for preceding_case in switch_statement.cases[..current_index].iter().rev() {
        let mut can_fall_through = true;
        let mut writes_guard_subject = false;
        for statement in &preceding_case.consequent {
            if statement_always_exits(statement) {
                can_fall_through = false;
                break;
            }
            if source_writes_guard_subject(ctx.source_range(statement.span()), guard_subjects) {
                writes_guard_subject = true;
            }
        }
        if !can_fall_through {
            break;
        }
        if writes_guard_subject {
            return true;
        }
    }
    false
}

fn positive_test_references_subjects(source: &str, guard_subjects: &[String]) -> bool {
    let compact = normalized_expression_source(source);
    guard_subjects.iter().any(|subject| {
        compact == *subject
            || compact_contains_guard_pattern(&compact, &format!("{subject}&&"))
            || compact_contains_guard_pattern(&compact, &format!("{subject}!==null"))
            || compact_contains_guard_pattern(&compact, &format!("{subject}!=null"))
            || compact_contains_guard_pattern(
                &compact,
                &format!("typeof{subject}===\"number\""),
            )
            || compact_contains_guard_pattern(
                &compact,
                &format!("typeof{subject}==\"number\""),
            )
    })
}

fn source_references_guard_subject(source: &str, guard_subjects: &[String]) -> bool {
    let compact = normalized_expression_source(source).replace("?.", ".");
    guard_subjects.iter().any(|subject| {
        compact == *subject
            || compact.starts_with(&format!("{subject}."))
            || compact.contains(&format!("({subject}."))
    })
}

fn negative_test_references_subjects(source: &str, guard_subjects: &[String]) -> bool {
    let compact = normalized_expression_source(source);
    guard_subjects.iter().any(|subject| {
        compact == format!("!{subject}")
            || compact.starts_with(&format!("!{subject}||"))
            || compact_contains_guard_pattern(&compact, &format!("||!{subject}"))
            || compact_contains_guard_pattern(&compact, &format!("{subject}==null"))
            || compact_contains_guard_pattern(&compact, &format!("{subject}===null"))
            || compact_contains_guard_pattern(&compact, &format!("{subject}===undefined"))
            || compact_contains_guard_pattern(
                &compact,
                &format!("typeof{subject}!==\"number\""),
            )
            || compact_contains_guard_pattern(
                &compact,
                &format!("typeof{subject}!=\"number\""),
            )
    })
}

fn compact_contains_guard_pattern(source: &str, pattern: &str) -> bool {
    source.match_indices(pattern).any(|(start, _)| {
        let end = start + pattern.len();
        let starts_with_identifier = pattern
            .chars()
            .next()
            .is_some_and(is_guard_path_character);
        let ends_with_identifier = pattern
            .chars()
            .next_back()
            .is_some_and(is_guard_path_character);
        (!starts_with_identifier
            || source[..start]
                .chars()
                .next_back()
                .is_none_or(|character| !is_guard_path_character(character) && character != '.'))
            && (!ends_with_identifier
                || source[end..]
                    .chars()
                    .next()
                    .is_none_or(|character| {
                        !is_guard_path_character(character) && character != '.'
                    }))
    })
}

fn is_guard_path_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '$')
}

fn binding_is_nan_clamped_before(
    symbol_id: oxc_semantic::SymbolId,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    if start >= end {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(statement) = candidate.kind() else {
            return false;
        };
        if statement.span.start < start || statement.span.end > end {
            return false;
        }
        let Expression::CallExpression(check_call) = statement.test.get_inner_expression() else {
            return false;
        };
        if !is_global_nan_check_for_symbol(check_call, symbol_id, ctx) {
            return false;
        }
        ctx.nodes().iter().any(|assignment_node| {
            let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                return false;
            };
            if !statement
                .consequent
                .span()
                .contains_inclusive(assignment.span)
                || assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            {
                return false;
            }
            let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                &assignment.left
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(symbol_id)
                && matches!(assignment.right.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value.is_finite())
        })
    })
}

fn is_global_nan_check_for_symbol(
    call: &oxc_ast::ast::CallExpression<'_>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(Expression::Identifier(argument)) = call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(argument.reference_id())
        .symbol_id()
        != Some(symbol_id)
    {
        return false;
    }
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "isNaN" | "isFinite")
                && ctx.is_reference_to_global_variable(identifier)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            matches!(member.static_property_name().as_deref(), Some("isNaN" | "isFinite"))
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Number" && ctx.is_reference_to_global_variable(identifier))
        }),
    }
}

fn is_transparent_wrapper(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::TSNonNullExpression(_)
    )
}

fn normalized_expression_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn source_writes_guard_subject(source: &str, guard_subjects: &[String]) -> bool {
    let compact = normalized_expression_source(source);
    guard_subjects.iter().any(|subject| {
        source_assigns_subject(&compact, subject)
            || subject
                .split_once('.')
                .is_some_and(|(root, _)| source_assigns_subject(&compact, root))
    })
}

fn source_assigns_subject(source: &str, subject: &str) -> bool {
    let mut offset = 0;
    while let Some(index) = source[offset..].find(subject) {
        let end = offset + index + subject.len();
        let suffix = &source[end..];
        if suffix.starts_with('=') && !suffix.starts_with("==") {
            return true;
        }
        if suffix.starts_with('.') {
            let member_write = suffix.split([';', ',', ')', '}']).next().unwrap_or(suffix);
            if member_write.contains('=') && !member_write.contains("==") {
                return true;
            }
        }
        offset = end;
    }
    false
}
