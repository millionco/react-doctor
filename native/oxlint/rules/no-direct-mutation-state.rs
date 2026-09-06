use oxc_ast::{AstKind, ast::MethodDefinitionKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    ast_util::get_outer_member_expression,
    context::LintContext,
    rule::Rule,
    utils::{is_es5_component, is_es6_component, is_state_member_expression},
};

const MESSAGE: &str = "Mutating `this.state` by hand never triggers a redraw on its own & a later setState can overwrite it, so use `this.setState` instead.";

#[derive(Debug, Default, Clone)]
pub struct NoDirectMutationState;

declare_oxc_lint!(
    /// Disallow direct mutation of this.state outside component constructors.
    NoDirectMutationState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow direct mutation of this.state.",
);

impl Rule for NoDirectMutationState {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let target = match node.kind() {
            AstKind::AssignmentExpression(assignment_expression) => {
                assignment_expression.left.as_simple_assignment_target()
            }
            AstKind::UpdateExpression(update_expression) => Some(&update_expression.argument),
            _ => return,
        };
        let Some(target) = target else {
            return;
        };
        let Some(outer_member_expression) = get_outer_member_expression(target) else {
            return;
        };
        if !is_state_member_expression(outer_member_expression)
            || should_ignore_mutation(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.kind().span()));
    }
}

fn should_ignore_mutation<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut is_constructor = false;
    let mut is_inside_call_expression = false;
    let mut is_inside_component = false;

    for ancestor in ctx.nodes().ancestors(node.id()) {
        if let AstKind::MethodDefinition(method_definition) = ancestor.kind()
            && method_definition.kind == MethodDefinitionKind::Constructor
        {
            is_constructor = true;
        }
        if matches!(ancestor.kind(), AstKind::CallExpression(_)) {
            is_inside_call_expression = true;
        }
        if is_es5_component(ancestor) || is_es6_component(ancestor) {
            is_inside_component = true;
        }
        if matches!(ancestor.kind(), AstKind::Class(_)) {
            break;
        }
    }

    (is_constructor && !is_inside_call_expression) || !is_inside_component
}
