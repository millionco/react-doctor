use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, FunctionType, NewExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, LogicalOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INTL_CLASS_NAMES: [&str; 8] = [
    "NumberFormat",
    "DateTimeFormat",
    "Collator",
    "RelativeTimeFormat",
    "ListFormat",
    "PluralRules",
    "Segmenter",
    "DisplayNames",
];
const CACHE_LOOKUP_METHOD_NAMES: [&str; 3] = ["has", "get", "includes"];

#[derive(Debug, Default, Clone)]
pub struct JsHoistIntl;

declare_oxc_lint!(
    /// Warns when an Intl formatter is rebuilt on every function call.
    JsHoistIntl,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Intl formatter rebuilt each call.",
);

impl Rule for JsHoistIntl {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(construction) = node.kind() else {
            return;
        };
        let Some(class_name) = intl_class_name(construction, ctx) else {
            return;
        };
        let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if is_stable_hook_callback(enclosing_function, ctx)
            || is_inside_cache_memo(node, construction, enclosing_function, ctx)
            || is_discarded_probe_inside_try(node, ctx)
            || has_dynamic_utility_arguments(construction, enclosing_function, ctx)
        {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This is slow because new Intl.{class_name}() rebuilds on every call inside a function, so move it to the top of the file, or wrap it in useMemo"
            ))
            .with_label(construction.span),
        );
    }
}

fn intl_class_name<'a>(
    construction: &'a NewExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let member = construction.callee.as_member_expression()?;
    let Expression::Identifier(namespace) = member.object() else {
        return None;
    };
    if namespace.name != "Intl"
        || ctx
            .scoping()
            .get_reference(namespace.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let class_name = member_expression_identifier_property_name(member)?;
    INTL_CLASS_NAMES.contains(&class_name).then_some(class_name)
}

fn is_stable_hook_callback(function: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(function.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|argument| argument.span() == function.span())
    {
        return false;
    }
    let hook_name = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        callee => callee
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    };
    matches!(hook_name, Some("useMemo" | "useCallback" | "useRef"))
}

fn is_inside_cache_memo<'a>(
    construction_node: &AstNode<'a>,
    construction: &NewExpression<'a>,
    enclosing_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child = construction_node;
    for ancestor in ctx.nodes().ancestors(construction_node.id()) {
        if ancestor.id() == enclosing_function.id() {
            return false;
        }
        match ancestor.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.right.span() == child.span() =>
            {
                if matches!(
                    assignment.operator,
                    AssignmentOperator::LogicalNullish | AssignmentOperator::LogicalOr
                ) {
                    return true;
                }
                if assignment.operator == AssignmentOperator::Assign
                    && matches!(&assignment.left, AssignmentTarget::AssignmentTargetIdentifier(identifier)
                        if identifier_is_initialized_from_cache_lookup(identifier, ctx))
                {
                    return true;
                }
            }
            AstKind::CallExpression(call)
                if is_persistent_cache_set_write(call, construction, enclosing_function, ctx) =>
            {
                return true;
            }
            AstKind::LogicalExpression(logical)
                if logical.right.span() == child.span()
                    && matches!(
                        logical.operator,
                        LogicalOperator::Or | LogicalOperator::Coalesce
                    )
                    && contains_cache_lookup(logical.left.span(), ctx) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional)
                if (conditional.consequent.span() == child.span()
                    || conditional.alternate.span() == child.span())
                    && contains_cache_lookup(conditional.test.span(), ctx) =>
            {
                return true;
            }
            AstKind::IfStatement(statement)
                if (statement.consequent.span() == child.span()
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child.span()))
                    && contains_cache_lookup(statement.test.span(), ctx)
                    && contains_cache_write(child.span(), ctx) =>
            {
                return true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn is_cache_lookup_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    call.callee
        .as_member_expression()
        .and_then(member_expression_identifier_property_name)
        .is_some_and(|method_name| CACHE_LOOKUP_METHOD_NAMES.contains(&method_name))
}

fn contains_cache_lookup(span: oxc_span::Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && (matches!(candidate.kind(), AstKind::CallExpression(call) if call
                .callee
                .as_member_expression()
                .and_then(member_expression_identifier_property_name)
                .is_some_and(|method_name| CACHE_LOOKUP_METHOD_NAMES.contains(&method_name)))
                || matches!(candidate.kind(), AstKind::ComputedMemberExpression(_)))
    })
}

fn contains_cache_write(span: oxc_span::Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(call) => {
                call.callee
                    .as_member_expression()
                    .and_then(member_expression_identifier_property_name)
                    == Some("set")
            }
            AstKind::AssignmentExpression(assignment) => match &assignment.left {
                AssignmentTarget::ComputedMemberExpression(_) => true,
                AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                    identifier_is_initialized_from_cache_lookup(identifier, ctx)
                }
                _ => false,
            },
            _ => false,
        }
    })
}

fn identifier_is_initialized_from_cache_lookup<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    identifier_initializer(identifier, ctx).is_some_and(is_cache_lookup_call)
}

fn is_persistent_cache_set_write<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    construction: &NewExpression<'a>,
    enclosing_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    if member_expression_identifier_property_name(member) != Some("set")
        || !call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == construction.span)
        })
    {
        return false;
    }
    let Some(receiver_root) = root_identifier(member.object()) else {
        return true;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(receiver_root.reference_id())
        .symbol_id()
    else {
        return true;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    !enclosing_function
        .span()
        .contains_inclusive(declaration.span())
}

fn root_identifier<'a>(
    mut expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    loop {
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => return Some(identifier),
            inner => {
                let member = inner.as_member_expression()?;
                expression = member.object();
            }
        }
    }
}

fn is_discarded_probe_inside_try(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let statement = ctx.nodes().parent_node(node.id());
    if !matches!(statement.kind(), AstKind::ExpressionStatement(_)) {
        return false;
    }
    let mut child = statement;
    for ancestor in ctx.nodes().ancestors(statement.id()) {
        match ancestor.kind() {
            AstKind::TryStatement(try_statement)
                if try_statement.block.node_id.get() == child.id() =>
            {
                return true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn has_dynamic_utility_arguments<'a>(
    construction: &NewExpression<'a>,
    enclosing_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function_name) = utility_function_name(enclosing_function, ctx) else {
        return false;
    };
    if is_component_or_hook_name(function_name) {
        return false;
    }
    construction.arguments.iter().any(|argument| {
        let Some(argument_expression) = argument.as_expression() else {
            return false;
        };
        ctx.nodes().iter().any(|candidate| {
            if !argument_expression
                .span()
                .contains_inclusive(candidate.span())
                || !identifier_executes_in_argument(
                    candidate,
                    argument_expression.span(),
                    enclosing_function,
                    ctx,
                )
            {
                return false;
            }
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return false;
            };
            identifier_resolves_to_function_parameter(identifier, enclosing_function, ctx)
        })
    })
}

fn utility_function_name<'a, 'ctx>(
    function_node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx str> {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.name.as_str());
    }
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.name.as_str())
}

fn is_component_or_hook_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        || name
            .strip_prefix("use")
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn identifier_executes_in_argument(
    identifier_node: &AstNode<'_>,
    argument_span: oxc_span::Span,
    enclosing_function: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(identifier_node.id()) {
        if ancestor.id() == enclosing_function.id() {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && ancestor.span() != argument_span
        {
            return false;
        }
    }
    false
}

fn identifier_resolves_to_function_parameter<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    enclosing_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current_identifier = identifier;
    let mut visited_symbols = rustc_hash::FxHashSet::default();
    loop {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(current_identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if function_parameter_spans(enclosing_function)
            .any(|parameter_span| parameter_span.contains_inclusive(declaration.span()))
        {
            return true;
        }
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        let Some(root) = root_identifier(initializer) else {
            return false;
        };
        current_identifier = root;
    }
}

fn function_parameter_spans<'a>(
    function: &'a AstNode<'a>,
) -> impl Iterator<Item = oxc_span::Span> + 'a {
    let parameters = match function.kind() {
        AstKind::Function(function) => function.params.items.as_slice(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.as_slice(),
        _ => &[],
    };
    parameters.iter().map(GetSpan::span)
}
