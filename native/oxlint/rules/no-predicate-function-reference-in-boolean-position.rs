use oxc_ast::{
    AstKind,
    ast::{Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const PREDICATE_PREFIXES: [&str; 5] = ["is", "has", "can", "should", "will"];

#[derive(Debug, Default, Clone)]
pub struct NoPredicateFunctionReferenceInBooleanPosition;

declare_oxc_lint!(
    /// Disallow predicate-named function references in boolean positions without calling them.
    NoPredicateFunctionReferenceInBooleanPosition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow predicate function references used as boolean values.",
);

impl Rule for NoPredicateFunctionReferenceInBooleanPosition {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return;
        };
        if !predicate_name_matches(identifier.name.as_str())
            || !predicate_is_in_boolean_context(node, ctx)
        {
            return;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return;
        };
        if !predicate_symbol_resolves_to_local_function(symbol_id, ctx, &mut Vec::new())
            || predicate_symbol_has_relevant_write(symbol_id, node, ctx)
            || predicate_is_existence_guard_over_used_reference(node, symbol_id, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This condition is always true because `{}` is a function reference, not its result, so the check never runs — call it as `{}()` to evaluate the predicate.",
                identifier.name, identifier.name
            ))
            .with_label(identifier.span),
        );
    }
}

fn predicate_name_matches(name: &str) -> bool {
    PREDICATE_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
    })
}

fn predicate_is_in_boolean_context<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::UnaryExpression(unary) => {
                return unary.operator == UnaryOperator::LogicalNot
                    && unary.argument.span() == current.span();
            }
            AstKind::IfStatement(statement) => return statement.test.span() == current.span(),
            AstKind::WhileStatement(statement) => return statement.test.span() == current.span(),
            AstKind::DoWhileStatement(statement) => {
                return statement.test.span() == current.span();
            }
            AstKind::ForStatement(statement) => {
                return statement
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span() == current.span());
            }
            AstKind::ConditionalExpression(expression) => {
                return expression.test.span() == current.span();
            }
            AstKind::LogicalExpression(logical) => {
                if logical.operator == LogicalOperator::And && logical.left.span() == current.span()
                {
                    return true;
                }
                if !matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) {
                    return false;
                }
                current = transparent_expression_root(parent, ctx);
            }
            _ => return false,
        }
    }
}

fn predicate_symbol_resolves_to_local_function(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if matches!(
                function.r#type,
                FunctionType::FunctionDeclaration | FunctionType::FunctionExpression
            ) =>
        {
            predicate_initializer_executes_unconditionally(declaration, false, ctx)
        }
        AstKind::VariableDeclarator(declarator) => {
            if declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return false;
            }
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            match initializer {
                Expression::Identifier(identifier) => {
                    if identifier.name == "Boolean"
                        && ctx.is_reference_to_global_variable(identifier)
                    {
                        return true;
                    }
                    ctx.scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some_and(|alias_symbol_id| {
                            predicate_symbol_resolves_to_local_function(
                                alias_symbol_id,
                                ctx,
                                visited_symbol_ids,
                            )
                        })
                }
                Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_) => {
                    let parent = ctx.nodes().parent_node(declaration.id());
                    let is_block_scoped = matches!(
                        parent.kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if !variable_declaration.kind.is_var()
                    );
                    predicate_initializer_executes_unconditionally(
                        declaration,
                        is_block_scoped,
                        ctx,
                    )
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn predicate_initializer_executes_unconditionally(
    declaration: &AstNode<'_>,
    stops_at_block_scope: bool,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(declaration.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::CatchClause(_)
        ) {
            return false;
        }
        if stops_at_block_scope && matches!(ancestor.kind(), AstKind::BlockStatement(_)) {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
        ) {
            return true;
        }
    }
    true
}

fn predicate_symbol_has_relevant_write(
    symbol_id: SymbolId,
    reference_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let reference_function_id = predicate_nearest_function_node_id(reference_node.id(), ctx);
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let write_node = ctx.nodes().get_node(reference.node_id());
            predicate_nearest_function_node_id(write_node.id(), ctx) != reference_function_id
                || write_node.span().start < reference_node.span().start
        })
}

fn predicate_nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn predicate_is_existence_guard_over_used_reference<'a>(
    identifier_node: &AstNode<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(identifier_node, ctx);
    let mut parent = ctx.nodes().parent_node(current.id());
    loop {
        let AstKind::LogicalExpression(logical) = parent.kind() else {
            break;
        };
        if logical.operator != LogicalOperator::And {
            break;
        }
        if logical.left.span() == current.span()
            && predicate_span_contains_reference_of(logical.right.span(), symbol_id, ctx)
        {
            return true;
        }
        current = transparent_expression_root(parent, ctx);
        parent = ctx.nodes().parent_node(current.id());
    }
    if matches!(
        parent.kind(),
        AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot
    ) {
        current = parent;
        parent = ctx.nodes().parent_node(current.id());
    }
    match parent.kind() {
        AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
            predicate_span_contains_reference_of(statement.consequent.span(), symbol_id, ctx)
                || statement.alternate.as_ref().is_some_and(|alternate| {
                    predicate_span_contains_reference_of(alternate.span(), symbol_id, ctx)
                })
        }
        AstKind::ConditionalExpression(expression) if expression.test.span() == current.span() => {
            predicate_span_contains_reference_of(expression.consequent.span(), symbol_id, ctx)
                || predicate_span_contains_reference_of(expression.alternate.span(), symbol_id, ctx)
        }
        _ => false,
    }
}

fn predicate_span_contains_reference_of(
    span: oxc_span::Span,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            span.contains_inclusive(reference_node.span())
                && !predicate_reference_is_property_name(reference_node, ctx)
        })
}

fn predicate_reference_is_property_name(
    reference_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(reference_node.id());
    match parent.kind() {
        AstKind::StaticMemberExpression(member) => member.property.span == reference_node.span(),
        AstKind::ObjectProperty(property) => {
            !property.computed && property.key.span() == reference_node.span()
        }
        _ => false,
    }
}
