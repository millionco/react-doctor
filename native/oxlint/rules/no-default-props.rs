use oxc_ast::{
    AstKind,
    ast::{AssignmentOperator, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoDefaultProps;

declare_oxc_lint!(
    /// Disallow function component defaultProps assignments in React 19.
    NoDefaultProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow function component defaultProps assignments in React 19.",
);

impl Rule for NoDefaultProps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::AssignmentExpression(assignment) = node.kind() else {
            return;
        };
        if assignment.operator != AssignmentOperator::Assign {
            return;
        }
        let Some(MemberExpression::StaticMemberExpression(member_expression)) =
            assignment.left.as_member_expression()
        else {
            return;
        };
        if member_expression.property.name != "defaultProps" {
            return;
        }
        let Expression::Identifier(receiver) = &member_expression.object else {
            return;
        };
        let receiver_name = receiver.name.as_str();
        if !receiver_name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || is_stable_default_props_class_receiver(receiver, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{receiver_name}.defaultProps stops applying in React 19, so your users see missing defaults. Set them in the destructured props parameter instead, like `function {receiver_name}({{ size = \"md\" }})`."
            ))
            .with_label(member_expression.span),
        );
    }
}

fn is_stable_default_props_class_receiver(
    receiver: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut visited_symbol_ids = Vec::new();
    let mut reference = receiver;
    loop {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(reference.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id)
            || symbol_has_write_before(symbol_id, reference.span.start, ctx)
        {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Class(_) => return true,
            AstKind::VariableDeclarator(declarator) => {
                let parent = ctx.nodes().parent_node(declaration.id());
                if !matches!(
                    parent.kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                ) {
                    return false;
                }
                let Some(initializer) = declarator.init.as_ref() else {
                    return false;
                };
                match initializer.get_inner_expression() {
                    Expression::ClassExpression(_) => return true,
                    Expression::Identifier(identifier) => reference = identifier,
                    _ => return false,
                }
            }
            _ => return false,
        }
    }
}
