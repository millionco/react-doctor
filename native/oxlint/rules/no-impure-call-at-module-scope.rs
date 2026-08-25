use oxc_ast::{
    AstKind,
    ast::Expression,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const IMPURE_MEMBER_CALLS: [(&str, &str); 3] = [
    ("Math", "random"),
    ("Date", "now"),
    ("performance", "now"),
];

#[derive(Debug, Default, Clone)]
pub struct NoImpureCallAtModuleScope;

declare_oxc_lint!(
    /// Disallow nondeterministic built-ins evaluated at module scope.
    NoImpureCallAtModuleScope,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow nondeterministic module-scope built-ins.",
);

impl Rule for NoImpureCallAtModuleScope {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(label) = impure_builtin_label(node, ctx) else {
            return;
        };
        if !is_module_scope_evaluation(node, ctx) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`{label}` runs once when this module loads, so the value is frozen for the whole server process and every SSR request reuses it — move it into a function or component so it evaluates per request."
            ))
            .with_label(node.span()),
        );
    }
}

fn impure_builtin_label(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match node.kind() {
        AstKind::NewExpression(new_expression) => {
            let Expression::Identifier(callee) = &new_expression.callee else {
                return None;
            };
            (callee.name == "Date"
                && new_expression.arguments.is_empty()
                && is_global_reference(callee, ctx))
            .then(|| "new Date()".to_string())
        }
        AstKind::CallExpression(call_expression) => {
            if let Expression::Identifier(callee) = &call_expression.callee
                && callee.name == "Date"
                && call_expression.arguments.is_empty()
                && is_global_reference(callee, ctx)
            {
                return Some("Date()".to_string());
            }
            let member_expression = call_expression.callee.as_member_expression()?;
            let Expression::Identifier(receiver) = member_expression.object().get_inner_expression()
            else {
                return None;
            };
            let property_name = member_expression.static_property_name()?;
            (IMPURE_MEMBER_CALLS
                .iter()
                .any(|(namespace, method)| receiver.name == *namespace && property_name == *method)
                && is_global_reference(receiver, ctx))
            .then(|| format!("{}.{}()", receiver.name, property_name))
        }
        _ => None,
    }
}

fn is_global_reference(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn is_module_scope_evaluation(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut child = node;
    let mut cursor = ctx.nodes().parent_node(node.id());
    loop {
        match cursor.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                let function_root = transparent_expression_root(cursor, ctx);
                let call_node = ctx.nodes().parent_node(function_root.id());
                if !matches!(
                    call_node.kind(),
                    AstKind::CallExpression(call_expression)
                        if call_expression.callee.span() == function_root.span()
                ) {
                    return false;
                }
                child = call_node;
                cursor = ctx.nodes().parent_node(call_node.id());
                continue;
            }
            AstKind::MethodDefinition(_) => return false,
            AstKind::ConditionalExpression(conditional) if conditional.test.span() != child.span() => {
                let server_test_value = server_value_of_browser_global_test(
                    &conditional.test,
                    ctx,
                    &mut Vec::new(),
                );
                if server_test_value.is_some_and(|server_value| {
                    conditional.consequent.span() == child.span() && !server_value
                        || conditional.alternate.span() == child.span() && server_value
                }) {
                    return false;
                }
            }
            AstKind::LogicalExpression(logical)
                if logical.right.span() == child.span()
                    && matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
            {
                let server_test_value =
                    server_value_of_browser_global_test(&logical.left, ctx, &mut Vec::new());
                if server_test_value.is_some_and(|server_value| {
                    logical.operator == LogicalOperator::And && !server_value
                        || logical.operator == LogicalOperator::Or && server_value
                }) {
                    return false;
                }
            }
            AstKind::PropertyDefinition(property) => {
                if !property.r#static
                    || property
                        .value
                        .as_ref()
                        .is_none_or(|value| !value.span().contains_inclusive(child.span()))
                {
                    return false;
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                let binding = declarator.id.get_binding_identifier();
                let is_top_level_binding = binding.is_some_and(|binding| {
                    ctx.scoping()
                        .scope_flags(ctx.scoping().symbol_scope_id(binding.symbol_id()))
                        .is_top()
                });
                let declaration = ctx.nodes().parent_node(cursor.id());
                let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
                    return false;
                };
                if !variable_declaration.kind.is_const() {
                    let Some(binding) = binding else {
                        return false;
                    };
                    if ctx
                        .scoping()
                        .get_resolved_references(binding.symbol_id())
                        .any(oxc_semantic::Reference::is_write)
                    {
                        return false;
                    }
                }
                if is_top_level_binding {
                    return true;
                }
                let mut declaration_parent = ctx.nodes().parent_node(declaration.id());
                if matches!(declaration_parent.kind(), AstKind::ExportNamedDeclaration(_)) {
                    declaration_parent = ctx.nodes().parent_node(declaration_parent.id());
                }
                return matches!(declaration_parent.kind(), AstKind::Program(_));
            }
            AstKind::Program(_) => return true,
            _ => {}
        }
        child = cursor;
        cursor = ctx.nodes().parent_node(cursor.id());
    }
}

fn server_value_of_browser_global_test<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
            visited_symbol_ids.push(symbol_id);
            let result = server_value_of_browser_global_test(initializer, ctx, visited_symbol_ids);
            visited_symbol_ids.pop();
            result
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            server_value_of_browser_global_test(&unary.argument, ctx, visited_symbol_ids)
                .map(|value| !value)
        }
        Expression::LogicalExpression(logical) => {
            let left = server_value_of_browser_global_test(
                &logical.left,
                ctx,
                &mut visited_symbol_ids.clone(),
            )?;
            match logical.operator {
                LogicalOperator::And if !left => Some(false),
                LogicalOperator::Or if left => Some(true),
                LogicalOperator::And | LogicalOperator::Or => server_value_of_browser_global_test(
                    &logical.right,
                    ctx,
                    visited_symbol_ids,
                ),
                _ => None,
            }
        }
        Expression::BinaryExpression(binary) => {
            if !is_undefined_typeof_browser_global(&binary.left, ctx)
                && !is_undefined_typeof_browser_global(&binary.right, ctx)
            {
                return None;
            }
            let has_undefined_literal = matches!(
                binary.left.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value == "undefined"
            ) || matches!(
                binary.right.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value == "undefined"
            );
            if !has_undefined_literal {
                return None;
            }
            match binary.operator {
                BinaryOperator::Equality | BinaryOperator::StrictEquality => Some(true),
                BinaryOperator::Inequality | BinaryOperator::StrictInequality => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

fn is_undefined_typeof_browser_global(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::UnaryExpression(unary) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = unary.argument.get_inner_expression() else {
        return false;
    };
    unary.operator == UnaryOperator::Typeof
        && matches!(identifier.name.as_str(), "window" | "document")
        && is_global_reference(identifier, ctx)
}
