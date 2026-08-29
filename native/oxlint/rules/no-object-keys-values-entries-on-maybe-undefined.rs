use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`Object.keys/values/entries` throws `Cannot convert undefined or null to object` when this value is missing — add a `?? {}` fallback or a null check so the call always receives an object.";

#[derive(Debug, Default, Clone)]
pub struct NoObjectKeysValuesEntriesOnMaybeUndefined;

declare_oxc_lint!(
    /// Disallow Object iteration methods on syntactically maybe-undefined values.
    NoObjectKeysValuesEntriesOnMaybeUndefined,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Object.keys/values/entries on maybe-undefined value.",
);

impl Rule for NoObjectKeysValuesEntriesOnMaybeUndefined {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return;
        };
        if !matches!(
            member.static_property_name().as_deref(),
            Some("keys" | "values" | "entries")
        ) {
            return;
        }
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return;
        };
        if receiver.name != "Object" || !ctx.is_reference_to_global_variable(receiver) {
            return;
        }
        let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
            return;
        };
        if is_inside_consuming_catch(node, ctx) {
            return;
        }

        if contains_optional_chain(argument) {
            if !optional_chain_is_guarded(node, argument, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
            }
            return;
        }

        let Expression::Identifier(identifier) = argument.get_inner_expression() else {
            return;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return;
        };
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::FormalParameter(parameter) = declaration.kind() else {
            return;
        };
        let BindingPattern::BindingIdentifier(binding) = &parameter.pattern else {
            return;
        };
        let parameter_source = ctx.source_range(parameter.span());
        let binding_prefix = parameter_source
            .split_once(':')
            .map_or(parameter_source, |(prefix, _)| prefix);
        if !binding_prefix.contains('?') || parameter_source.contains('=') {
            return;
        }
        if !identifier_is_guarded_or_normalized(node, binding.name.as_str(), symbol_id, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

fn contains_optional_chain(expression: &Expression<'_>) -> bool {
    matches!(expression, Expression::ChainExpression(_))
        || matches!(
            expression.get_inner_expression(),
            Expression::ChainExpression(_)
        )
        || matches!(expression.get_inner_expression(), Expression::CallExpression(call) if call.optional)
        || expression
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| member.optional())
}

fn optional_chain_is_guarded(
    call_node: &AstNode<'_>,
    argument: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let argument_source = normalized_argument_access_source(ctx.source_range(argument.span()));
    let guard_path = argument_source
        .find('[')
        .map_or(argument_source.as_str(), |index| {
            argument_source[..index].trim_end_matches('.')
        });
    let root_name = guard_path
        .split(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '$'
        })
        .find(|segment| !segment.is_empty())
        .unwrap_or("");
    if root_name.is_empty() {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.right.span().contains_inclusive(call_node.span()) =>
            {
                let left = normalized_access_source(ctx.source_range(logical.left.span()));
                if logical.operator == oxc_syntax::operator::LogicalOperator::And
                    && source_positively_guards(&left, guard_path)
                {
                    return true;
                }
            }
            AstKind::IfStatement(statement) => {
                let test = normalized_access_source(ctx.source_range(statement.test.span()));
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_positively_guards(&test, guard_path)
                    && !source_proves_absence(&test, guard_path)
                {
                    return true;
                }
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(call_node.span()))
                    && source_proves_absence(&test, guard_path)
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                let test = normalized_access_source(ctx.source_range(conditional.test.span()));
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_positively_guards(&test, guard_path)
                    && !source_proves_absence(&test, guard_path)
                {
                    return true;
                }
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_proves_absence(&test, guard_path)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    has_preceding_access_presence_guard(call_node, guard_path, root_name, ctx)
}

fn identifier_is_guarded_or_normalized(
    call_node: &AstNode<'_>,
    name: &str,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.right.span().contains_inclusive(call_node.span())
                    && ((logical.operator == oxc_syntax::operator::LogicalOperator::And
                        && source_mentions_positive_name(
                            ctx.source_range(logical.left.span()),
                            name,
                        ))
                        || (logical.operator == oxc_syntax::operator::LogicalOperator::Or
                            && source_mentions_negative_name(
                                ctx.source_range(logical.left.span()),
                                name,
                            ))) =>
            {
                return true;
            }
            AstKind::IfStatement(statement) => {
                let test = ctx.source_range(statement.test.span());
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_mentions_positive_name(test, name)
                {
                    return true;
                }
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(call_node.span()))
                    && source_mentions_negative_name(test, name)
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                let test = ctx.source_range(conditional.test.span());
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_mentions_positive_name(test, name)
                {
                    return true;
                }
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(call_node.span())
                    && source_mentions_negative_name(test, name)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    has_preceding_identifier_presence_guard(call_node, name, ctx)
        || has_preceding_identifier_normalization(call_node, name, symbol_id, ctx)
}

fn has_preceding_access_presence_guard(
    call_node: &AstNode<'_>,
    path: &str,
    root_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => continue,
        };
        let containing_statement_start = statements
                .iter()
                .find(|statement| statement.span().contains_inclusive(call_node.span()))
                .map_or(call_node.span().start, |statement| statement.span().start);
        for statement in statements {
            if statement.span().end > containing_statement_start {
                break;
            }
            let Statement::IfStatement(statement) = statement else {
                continue;
            };
            if statement.alternate.is_some() || !statement_always_exits(&statement.consequent) {
                continue;
            }
            let test = normalized_access_source(ctx.source_range(statement.test.span()));
            let proves_absence = source_proves_absence(&test, path)
                || path == root_name && source_proves_empty_length(&test, root_name);
            if proves_absence
                && !source_assigns_name(
                    &ctx.source_text()
                        [statement.span.end as usize..call_node.span().start as usize],
                    root_name,
                )
                && !source_assigns_name(
                    &ctx.source_text()
                        [statement.span.end as usize..call_node.span().start as usize],
                    path,
                )
            {
                return true;
            }
        }
    }
    false
}

fn has_preceding_identifier_presence_guard(
    call_node: &AstNode<'_>,
    name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => continue,
        };
        let containing_statement_start = statements
                .iter()
                .find(|statement| statement.span().contains_inclusive(call_node.span()))
                .map_or(call_node.span().start, |statement| statement.span().start);
        for statement in statements {
            if statement.span().end > containing_statement_start {
                break;
            }
            let Statement::IfStatement(statement) = statement else {
                continue;
            };
            if statement.alternate.is_none()
                && statement_always_exits(&statement.consequent)
                && source_mentions_negative_name(ctx.source_range(statement.test.span()), name)
                && !source_assigns_name(
                    &ctx.source_text()
                        [statement.span.end as usize..call_node.span().start as usize],
                    name,
                )
            {
                return true;
            }
        }
    }
    false
}

fn has_preceding_identifier_normalization(
    call_node: &AstNode<'_>,
    name: &str,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => continue,
        };
        let containing_statement_start = statements
                .iter()
                .find(|statement| statement.span().contains_inclusive(call_node.span()))
                .map_or(call_node.span().start, |statement| statement.span().start);
        for statement in statements {
            if statement.span().end > containing_statement_start {
                break;
            }
            if statement_normalizes_identifier(statement, name, symbol_id, ctx) {
                return true;
            }
        }
    }
    false
}

fn statement_normalizes_identifier(
    statement: &Statement<'_>,
    name: &str,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let assignment = match statement {
        Statement::ExpressionStatement(statement) => {
            let Expression::AssignmentExpression(assignment) = &statement.expression else {
                return false;
            };
            assignment
        }
        Statement::IfStatement(statement) if statement.alternate.is_none() => {
            if !source_mentions_negative_name(ctx.source_range(statement.test.span()), name) {
                return false;
            }
            let Statement::ExpressionStatement(consequent) = &statement.consequent else {
                return false;
            };
            let Expression::AssignmentExpression(assignment) = &consequent.expression else {
                return false;
            };
            assignment
        }
        _ => return false,
    };
    if !matches!(
        assignment.operator,
        oxc_syntax::operator::AssignmentOperator::Assign
            | oxc_syntax::operator::AssignmentOperator::LogicalNullish
            | oxc_syntax::operator::AssignmentOperator::LogicalOr
    ) {
        return false;
    }
    let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    else {
        return false;
    };
    if identifier.name != name
        || ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            != Some(symbol_id)
    {
        return false;
    }
    normalized_assignment_value_is_present(&assignment.right)
}

fn normalized_assignment_value_is_present(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_)
        | Expression::NewExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::LogicalExpression(logical)
            if matches!(
                logical.operator,
                oxc_syntax::operator::LogicalOperator::Coalesce
                    | oxc_syntax::operator::LogicalOperator::Or
            ) =>
        {
            matches!(
                logical.right.get_inner_expression(),
                Expression::ObjectExpression(_)
            )
        }
        _ => false,
    }
}

fn source_mentions_positive_name(source: &str, name: &str) -> bool {
    let compact = compact_source(source);
    (source_positively_guards(&compact, name)
        || compact.contains(&format!("typeof{name}===\"object\"")))
        && !source_mentions_negative_name(source, name)
}

fn source_mentions_negative_name(source: &str, name: &str) -> bool {
    let compact = compact_source(source);
    source_proves_missing(&compact, name)
}

fn source_proves_empty_length(test: &str, root_name: &str) -> bool {
    test == format!("{root_name}.length===0")
        || test == format!("{root_name}.length==0")
        || test == format!("!{root_name}.length")
}

fn normalized_access_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .replace("?.", ".")
}

fn normalized_argument_access_source(source: &str) -> String {
    normalized_access_source(source)
        .replace("!.", ".")
        .replace("![", "[")
}

fn source_positively_guards(test: &str, path: &str) -> bool {
    let test = test.trim_matches(|character| character == '(' || character == ')');
    if test.starts_with('!') {
        return false;
    }
    if let Some(parts) = split_top_level_logical(test, "&&") {
        return parts
            .iter()
            .any(|part| source_positively_guards(part, path));
    }
    if let Some(parts) = split_top_level_logical(test, "||") {
        return parts
            .iter()
            .all(|part| source_positively_guards(part, path));
    }
    test == path
        || matches!(
            test.strip_prefix(path),
            Some("!==null" | "!=null" | "!==undefined" | "!=undefined")
        )
}

fn split_top_level_logical<'a>(source: &'a str, operator: &str) -> Option<Vec<&'a str>> {
    let bytes = source.as_bytes();
    let operator_bytes = operator.as_bytes();
    let mut depth = 0_u32;
    let mut start = 0;
    let mut parts = Vec::new();
    let mut index = 0;
    while index + operator_bytes.len() <= bytes.len() {
        match bytes[index] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if depth == 0 && &bytes[index..index + operator_bytes.len()] == operator_bytes {
            parts.push(&source[start..index]);
            index += operator_bytes.len();
            start = index;
            continue;
        }
        index += 1;
    }
    if parts.is_empty() {
        return None;
    }
    parts.push(&source[start..]);
    Some(parts)
}

fn source_proves_absence(test: &str, path: &str) -> bool {
    source_proves_missing(test, path)
}

fn source_proves_missing(test: &str, path: &str) -> bool {
    let test = test.trim_matches(|character| character == '(' || character == ')');
    if split_top_level_logical(test, "&&").is_some() {
        return false;
    }
    if let Some(parts) = split_top_level_logical(test, "||") {
        return parts
            .iter()
            .any(|part| source_proves_missing(part, path));
    }
    test == format!("!{path}")
        || test == format!("{path}===undefined")
        || test == format!("{path}==undefined")
        || test == format!("{path}===null")
        || test == format!("{path}==null")
        || test == format!("isEmptyOrNull({path})")
}

fn compact_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn source_assigns_name(source: &str, name: &str) -> bool {
    let mut offset = 0;
    while let Some(index) = source[offset..].find(name) {
        let end = offset + index + name.len();
        let suffix = &source[end..];
        if suffix.starts_with('=') && !suffix.starts_with("==") {
            return true;
        }
        offset = end;
    }
    false
}

fn is_inside_consuming_catch(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for function in ctx.nodes().ancestors(node.id()).filter(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
        )
    }) {
        let Some(callback_call_node) = ctx
            .nodes()
            .ancestors(function.id())
            .find(|ancestor| matches!(ancestor.kind(), AstKind::CallExpression(_)))
        else {
            continue;
        };
        let AstKind::CallExpression(callback_call) = callback_call_node.kind() else {
            continue;
        };
        if !callback_call
            .arguments
            .iter()
            .any(|argument| argument.span() == function.span())
        {
            continue;
        }
        let Some(callback_member) = callback_call.callee.as_member_expression() else {
            continue;
        };
        if !matches!(
            callback_member.static_property_name().as_deref(),
            Some("then" | "catch")
        ) {
            continue;
        }

        let mut chain_call_node = callback_call_node;
        loop {
            let member_node = ctx.nodes().parent_node(chain_call_node.id());
            let Some(chain_member) = member_node.kind().as_member_expression_kind() else {
                break;
            };
            if chain_member.object().span() != chain_call_node.span() {
                break;
            }
            let next_call_node = ctx.nodes().parent_node(member_node.id());
            let AstKind::CallExpression(next_call) = next_call_node.kind() else {
                break;
            };
            if next_call.callee.span() != member_node.span() {
                break;
            }
            if chain_member.static_property_name().as_deref() == Some("catch") {
                return next_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|handler| catch_handler_consumes_error(handler, ctx));
            }
            chain_call_node = next_call_node;
        }
    }
    false
}

fn catch_handler_consumes_error(handler: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    if !matches!(
        handler,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    !ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::ThrowStatement(_))
            && handler.span().contains_inclusive(candidate.span())
            && nearest_function_span(candidate, ctx) == Some(handler.span())
    })
}

fn nearest_function_span(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_span::Span> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
        )
        .then(|| ancestor.span())
    })
}
