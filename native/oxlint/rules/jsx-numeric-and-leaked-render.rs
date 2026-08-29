use std::collections::HashSet;

use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, CallExpression, ChainElement, Expression, MemberExpression, PropertyKey,
        TSSignature, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const JSX_NUMERIC_AND_LEAKED_RENDER_MESSAGE: &str = "React renders a literal `0` into your page when this count is 0 instead of nothing — compare it explicitly (`count > 0 && <X/>`) or use a ternary (`count ? <X/> : null`).";

#[derive(Debug, Default, Clone)]
pub struct JsxNumericAndLeakedRender;

struct JsxNumericAndCandidateIndex {
    jsx_node_ids_by_start: Vec<NodeId>,
    static_member_node_ids_by_start: Vec<NodeId>,
}

impl JsxNumericAndCandidateIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut jsx_node_ids_by_start = Vec::new();
        let mut static_member_node_ids_by_start = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXElement(_) | AstKind::JSXFragment(_) => {
                    jsx_node_ids_by_start.push(node.id());
                }
                AstKind::StaticMemberExpression(_) => {
                    static_member_node_ids_by_start.push(node.id());
                }
                _ => {}
            }
        }
        jsx_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        static_member_node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self {
            jsx_node_ids_by_start,
            static_member_node_ids_by_start,
        }
    }
}

declare_oxc_lint!(
    /// Prevent numeric short-circuit conditions from rendering a stray zero.
    JsxNumericAndLeakedRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prevent numeric JSX short-circuit leaks.",
);

impl Rule for JsxNumericAndLeakedRender {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let non_numeric_length_type_names = jsx_numeric_and_non_numeric_length_type_names(ctx);
        let candidate_index = JsxNumericAndCandidateIndex::new(ctx);
        let function_node_index = build_local_callback_nearest_function_node_index(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::LogicalExpression(logical) = node.kind() else {
                continue;
            };
            if logical.operator != LogicalOperator::And
                || matches!(ctx.nodes().parent_node(node.id()).kind(), AstKind::LogicalExpression(parent) if parent.operator == LogicalOperator::And)
                || !jsx_numeric_and_flows_to_child(node, ctx)
            {
                continue;
            }
            let mut operands = Vec::new();
            jsx_numeric_and_flatten(&logical.left, &mut operands);
            jsx_numeric_and_flatten(&logical.right, &mut operands);
            let Some(render_operand) = operands.last() else {
                continue;
            };
            if !jsx_numeric_and_is_render_expression(render_operand, &candidate_index, ctx) {
                continue;
            }
            let Some((index, operand)) =
                operands[..operands.len() - 1]
                    .iter()
                    .enumerate()
                    .find(|(_, operand)| {
                        jsx_numeric_and_is_numeric(operand, &non_numeric_length_type_names, ctx)
                    })
            else {
                continue;
            };
            if jsx_numeric_and_render_reads_guard_member(
                operand,
                render_operand,
                &candidate_index,
                ctx,
            ) || jsx_numeric_and_preceding_proves_positive(
                operand,
                &operands[..index],
                &function_node_index,
                ctx,
            )
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(JSX_NUMERIC_AND_LEAKED_RENDER_MESSAGE)
                    .with_label(operand.span()),
            );
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn jsx_numeric_and_flatten<'a>(
    expression: &'a Expression<'a>,
    operands: &mut Vec<&'a Expression<'a>>,
) {
    if let Expression::LogicalExpression(logical) = expression.get_inner_expression()
        && logical.operator == LogicalOperator::And
    {
        jsx_numeric_and_flatten(&logical.left, operands);
        jsx_numeric_and_flatten(&logical.right, operands);
    } else {
        operands.push(expression);
    }
}

fn jsx_numeric_and_flows_to_child(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current_id = node.id();
    for parent in ctx.nodes().ancestors(node.id()) {
        match parent.kind() {
            AstKind::JSXExpressionContainer(_) => {
                return matches!(
                    ctx.nodes().parent_node(parent.id()).kind(),
                    AstKind::JSXElement(_) | AstKind::JSXFragment(_)
                );
            }
            AstKind::LogicalExpression(logical) => {
                if logical.operator == LogicalOperator::Or
                    && ctx.nodes().get_node(current_id).span() == logical.left.span()
                {
                    return false;
                }
            }
            AstKind::ConditionalExpression(_)
            | AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_) => {}
            _ => return false,
        }
        current_id = parent.id();
    }
    false
}

fn jsx_numeric_and_is_render_expression(
    expression: &Expression<'_>,
    candidate_index: &JsxNumericAndCandidateIndex,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::CallExpression(call) => jsx_numeric_and_is_jsx_map(call, candidate_index, ctx),
        _ => false,
    }
}

fn jsx_numeric_and_is_jsx_map(
    call: &CallExpression<'_>,
    candidate_index: &JsxNumericAndCandidateIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return false;
    };
    if member.property.name != "map" {
        return false;
    }
    let Some(callback) = call
        .arguments
        .first()
        .and_then(|argument| argument.as_expression())
    else {
        return false;
    };
    if !matches!(
        callback.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let span = callback.span();
    let first_candidate_index = candidate_index
        .jsx_node_ids_by_start
        .partition_point(|node_id| ctx.nodes().get_node(*node_id).span().start < span.start);
    candidate_index.jsx_node_ids_by_start[first_candidate_index..]
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id).span())
        .take_while(|candidate_span| candidate_span.start <= span.end)
        .any(|candidate_span| span.contains_inclusive(candidate_span))
}

fn jsx_numeric_and_is_numeric<'a>(
    expression: &'a Expression<'a>,
    non_numeric_length_type_names: &HashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = jsx_numeric_and_member_expression(expression) {
        match member.static_property_name().as_deref() {
            Some("length") => {
                return !jsx_numeric_and_receiver_has_non_numeric_length(
                    member.object(),
                    non_numeric_length_type_names,
                    ctx,
                );
            }
            Some("size") => return jsx_numeric_and_collection_receiver(member.object(), ctx),
            _ => {}
        }
    }
    match expression {
        Expression::BinaryExpression(binary) => {
            matches!(
                binary.operator,
                BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
                    | BinaryOperator::Remainder
            ) || binary.operator == BinaryOperator::Addition
                && jsx_numeric_and_is_numeric(&binary.left, non_numeric_length_type_names, ctx)
                && jsx_numeric_and_is_numeric(&binary.right, non_numeric_length_type_names, ctx)
        }
        Expression::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "Number" | "parseInt" | "parseFloat") && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        Expression::NumericLiteral(_) => true,
        _ => false,
    }
}

fn jsx_numeric_and_collection_receiver<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(MemberExpression::StaticMemberExpression(member)) =
        jsx_numeric_and_member_expression(expression)
        && member.property.name == "current"
    {
        let Expression::Identifier(identifier) = member.object.get_inner_expression() else {
            return false;
        };
        return resolve_direct_unreassigned_initializer(identifier, ctx)
            .is_some_and(|initializer| jsx_numeric_and_hook_seed(initializer, "useRef"));
    }
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "Map" | "Set"))
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if resolve_direct_unreassigned_initializer(identifier, ctx)
                .is_some_and(jsx_numeric_and_collection_seed)
            {
                return true;
            }
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                return false;
            };
            pattern
                .elements
                .first()
                .and_then(Option::as_ref)
                .and_then(BindingPattern::get_binding_identifier)
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| jsx_numeric_and_hook_seed(initializer, "useState"))
        }
        _ => false,
    }
}

fn jsx_numeric_and_collection_seed(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "Map" | "Set"))
        }
        Expression::CallExpression(_) => jsx_numeric_and_hook_seed(expression, "useState"),
        _ => false,
    }
}

fn jsx_numeric_and_hook_seed(expression: &Expression<'_>, hook: &str) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let hook_matches = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == hook,
        Expression::StaticMemberExpression(member) => member.property.name == hook,
        _ => false,
    };
    hook_matches
        && call
            .arguments
            .first()
            .and_then(|argument| argument.as_expression())
            .is_some_and(jsx_numeric_and_collection_seed)
}

fn jsx_numeric_and_static_path(expression: &Expression<'_>) -> Option<String> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        _ => {
            let MemberExpression::StaticMemberExpression(member) =
                jsx_numeric_and_member_expression(expression)?
            else {
                return None;
            };
            Some(format!(
                "{}.{}",
                jsx_numeric_and_static_path(&member.object)?,
                member.property.name
            ))
        }
    }
}

fn jsx_numeric_and_member_expression<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a MemberExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ChainExpression(chain) => {
            if let Some(member) = chain.expression.as_member_expression() {
                Some(member)
            } else {
                match &chain.expression {
                    ChainElement::TSNonNullExpression(non_null) => {
                        jsx_numeric_and_member_expression(&non_null.expression)
                    }
                    _ => None,
                }
            }
        }
        expression => expression.as_member_expression(),
    }
}

fn jsx_numeric_and_preceding_proves_positive<'a>(
    operand: &'a Expression<'a>,
    preceding: &[&Expression<'a>],
    function_node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(path) = jsx_numeric_and_static_path(operand) else {
        return false;
    };
    if preceding
        .iter()
        .any(|expression| jsx_numeric_and_condition_proves_positive(expression, &path, 6, ctx))
    {
        return true;
    }
    let Some(member) = jsx_numeric_and_member_expression(operand) else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    jsx_numeric_and_is_constant_non_empty_state_array(receiver, ctx)
        || jsx_numeric_and_is_provably_non_empty_or_nullish(
            member.object(),
            6,
            function_node_index,
            ctx,
        )
}

fn jsx_numeric_and_receiver_has_non_numeric_length(
    expression: &Expression<'_>,
    non_numeric_length_type_names: &HashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    let type_name = match declaration.kind() {
        AstKind::FormalParameter(parameter)
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
        {
            parameter.type_annotation.as_ref().and_then(|annotation| {
                jsx_numeric_and_type_reference_name(&annotation.type_annotation)
            })
        }
        AstKind::FormalParameter(parameter) => {
            let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                return false;
            };
            if !pattern.properties.iter().any(|property| {
                property
                    .value
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
            }) {
                return false;
            }
            let Some(TSType::TSTypeLiteral(type_literal)) = parameter
                .type_annotation
                .as_ref()
                .map(|annotation| &annotation.type_annotation)
            else {
                return false;
            };
            type_literal.members.iter().find_map(|member| {
                let TSSignature::TSPropertySignature(property) = member else {
                    return None;
                };
                (!property.computed
                    && matches!(&property.key, PropertyKey::StaticIdentifier(property_name) if property_name.name == identifier.name))
                    .then(|| property.type_annotation.as_ref())
                .flatten()
                .and_then(|annotation| {
                    jsx_numeric_and_type_reference_name(&annotation.type_annotation)
                })
            })
        }
        _ => None,
    };
    let Some(type_name) = type_name else {
        return false;
    };
    non_numeric_length_type_names.contains(type_name)
}

fn jsx_numeric_and_non_numeric_length_type_names(ctx: &LintContext<'_>) -> HashSet<String> {
    ctx.nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::TSInterfaceDeclaration(interface)
                if interface
                .body
                .body
                .iter()
                .any(|member| {
                    let TSSignature::TSPropertySignature(property) = member else {
                        return false;
                    };
                    !property.computed
                        && matches!(&property.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "length")
                        && property.type_annotation.as_ref().is_some_and(|annotation| {
                            !matches!(&annotation.type_annotation, TSType::TSNumberKeyword(_))
                        })
                }) =>
            {
                Some(interface.id.name.to_string())
            }
            _ => None,
        })
        .collect()
}

fn jsx_numeric_and_type_reference_name<'a>(type_node: &'a TSType<'a>) -> Option<&'a str> {
    let TSType::TSTypeReference(reference) = type_node else {
        return None;
    };
    let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn jsx_numeric_and_is_constant_non_empty_state_array(
    receiver: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(call) = declarator
        .init
        .as_ref()
        .and_then(|initializer| jsx_numeric_and_hook_call(initializer, "useState"))
    else {
        return false;
    };
    let is_non_empty = call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
        .is_some_and(|initial_value| {
            matches!(initial_value, Expression::ArrayExpression(array)
                if array.elements.iter().any(|element| element.as_expression().is_some()))
        });
    if !is_non_empty {
        return false;
    }
    let Some(setter) = pattern.elements.get(1).and_then(Option::as_ref) else {
        return true;
    };
    let BindingPattern::BindingIdentifier(setter) = setter else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(setter.symbol_id())
        .next()
        .is_none()
}

fn jsx_numeric_and_hook_call<'a>(
    expression: &'a Expression<'a>,
    hook_name: &str,
) -> Option<&'a CallExpression<'a>> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let matches = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == hook_name,
        Expression::StaticMemberExpression(member) => member.property.name == hook_name,
        _ => false,
    };
    matches.then_some(call)
}

fn jsx_numeric_and_is_provably_non_empty_or_nullish<'a>(
    expression: &'a Expression<'a>,
    remaining_hops: u8,
    function_node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    if remaining_hops == 0 {
        return false;
    }
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::NullLiteral(_))
        || matches!(expression, Expression::Identifier(identifier) if identifier.name == "undefined")
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator == oxc_syntax::operator::UnaryOperator::Void)
    {
        return true;
    }
    if matches!(expression, Expression::ArrayExpression(array)
        if array.elements.iter().any(|element| element.as_expression().is_some()))
    {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            let consequent_is_provable =
                jsx_numeric_and_is_provably_non_empty_or_nullish(
                    &conditional.consequent,
                    remaining_hops - 1,
                    function_node_index,
                    ctx,
                ) || jsx_numeric_and_non_empty_branch_is_guarded(conditional, ctx);
            consequent_is_provable
                && jsx_numeric_and_is_provably_non_empty_or_nullish(
                    &conditional.alternate,
                    remaining_hops - 1,
                    function_node_index,
                    ctx,
                )
        }
        Expression::Identifier(identifier) => {
            let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
                return false;
            };
            if let Some(memo_call) = jsx_numeric_and_hook_call(initializer, "useMemo") {
                let Some(callback) = memo_call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    return false;
                };
                return jsx_numeric_and_direct_function_id(callback).is_none_or(|function_id| {
                    jsx_numeric_and_function_returns_are_provable(
                        function_id,
                        remaining_hops - 1,
                        function_node_index,
                        ctx,
                    )
                });
            }
            jsx_numeric_and_is_provably_non_empty_or_nullish(
                initializer,
                remaining_hops - 1,
                function_node_index,
                ctx,
            )
        }
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return false;
            };
            jsx_numeric_and_identifier_callable_returns_are_provable(
                callee,
                remaining_hops - 1,
                function_node_index,
                ctx,
            )
        }
        _ => false,
    }
}

fn jsx_numeric_and_non_empty_branch_is_guarded<'a>(
    conditional: &oxc_ast::ast::ConditionalExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(branch_path) = jsx_numeric_and_static_path(&conditional.consequent) else {
        return false;
    };
    let Expression::BinaryExpression(_) = conditional.test.get_inner_expression() else {
        return false;
    };
    jsx_numeric_and_condition_proves_positive(
        &conditional.test,
        &format!("{branch_path}.length"),
        1,
        ctx,
    )
}

fn jsx_numeric_and_direct_function_id(expression: &Expression<'_>) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn jsx_numeric_and_unwrap_callable_function_id(
    expression: &Expression<'_>,
) -> Option<oxc_semantic::NodeId> {
    if let Some(function_id) = jsx_numeric_and_direct_function_id(expression) {
        return Some(function_id);
    }
    let callback = jsx_numeric_and_hook_call(expression, "useCallback")?
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)?;
    jsx_numeric_and_direct_function_id(callback)
}

fn jsx_numeric_and_identifier_callable_returns_are_provable<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    remaining_hops: u8,
    function_node_index: &LocalCallbackNearestFunctionNodeIndex,
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
    let function_id = match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
        {
            declarator
                .init
                .as_ref()
                .and_then(jsx_numeric_and_unwrap_callable_function_id)
        }
        _ => None,
    };
    function_id.is_some_and(|function_id| {
        jsx_numeric_and_function_returns_are_provable(
            function_id,
            remaining_hops,
            function_node_index,
            ctx,
        )
    })
}

fn jsx_numeric_and_function_returns_are_provable<'a>(
    function_id: oxc_semantic::NodeId,
    remaining_hops: u8,
    function_node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return jsx_numeric_and_is_provably_non_empty_or_nullish(
            expression,
            remaining_hops,
            function_node_index,
            ctx,
        );
    }
    function_node_index.node_ids(function_id).iter().all(|node_id| {
        let candidate = ctx.nodes().get_node(*node_id);
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return true;
        };
        return_statement.argument.as_ref().is_none_or(|argument| {
            jsx_numeric_and_is_provably_non_empty_or_nullish(
                argument,
                remaining_hops,
                function_node_index,
                ctx,
            )
        })
    })
}

fn jsx_numeric_and_condition_proves_positive<'a>(
    expression: &Expression<'a>,
    path: &str,
    remaining_hops: u8,
    ctx: &LintContext<'a>,
) -> bool {
    if remaining_hops == 0 {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::BinaryExpression(binary) => {
            let (candidate, literal, direct) = match (&binary.left, &binary.right) {
                (left, Expression::NumericLiteral(literal)) => (left, literal.value, true),
                (Expression::NumericLiteral(literal), right) => (right, literal.value, false),
                _ => return false,
            };
            if jsx_numeric_and_static_path(candidate).as_deref() != Some(path) {
                return false;
            }
            match (binary.operator, direct) {
                (BinaryOperator::GreaterThan, true) | (BinaryOperator::LessThan, false) => {
                    literal >= 0.0
                }
                (BinaryOperator::GreaterEqualThan, true)
                | (BinaryOperator::LessEqualThan, false) => literal >= 1.0,
                (BinaryOperator::Inequality | BinaryOperator::StrictInequality, _) => {
                    literal == 0.0
                }
                (BinaryOperator::Equality | BinaryOperator::StrictEquality, _) => literal >= 1.0,
                _ => false,
            }
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            jsx_numeric_and_condition_proves_positive(&logical.left, path, remaining_hops - 1, ctx)
                || jsx_numeric_and_condition_proves_positive(
                    &logical.right,
                    path,
                    remaining_hops - 1,
                    ctx,
                )
        }
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                jsx_numeric_and_condition_proves_positive(
                    initializer,
                    path,
                    remaining_hops - 1,
                    ctx,
                )
            })
        }
        _ => false,
    }
}

fn jsx_numeric_and_render_reads_guard_member(
    guard: &Expression<'_>,
    render: &Expression<'_>,
    candidate_index: &JsxNumericAndCandidateIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(path) = jsx_numeric_and_static_path(guard) else {
        return false;
    };
    let span = render.span();
    let first_candidate_index = candidate_index
        .static_member_node_ids_by_start
        .partition_point(|node_id| ctx.nodes().get_node(*node_id).span().start < span.start);
    candidate_index.static_member_node_ids_by_start[first_candidate_index..]
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .take_while(|node| node.span().start <= span.end)
        .any(|node| {
            let AstKind::StaticMemberExpression(member) = node.kind() else {
                return false;
            };
            span.contains_inclusive(member.span())
                && jsx_numeric_and_static_path(&member.object).as_deref() == Some(path.as_str())
                && !matches!(
                    member.property.name.as_str(),
                    "toExponential"
                        | "toFixed"
                        | "toLocaleString"
                        | "toPrecision"
                        | "toString"
                        | "valueOf"
                )
        })
}
