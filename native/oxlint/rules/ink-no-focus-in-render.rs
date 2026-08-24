use oxc_ast::{ast::Expression, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const FOCUS_METHOD_NAMES: [&str; 3] = ["focus", "focusNext", "focusPrevious"];
const MESSAGE: &str = "Changing Ink focus during render can trigger render loops.";

#[derive(Debug, Default, Clone)]
pub struct InkNoFocusInRender;

declare_oxc_lint!(
    /// Disallow changing Ink focus during React render.
    InkNoFocusInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow Ink focus changes during render.",
);

impl Rule for InkNoFocusInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_focus_manager_method_call(call_expression, ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn is_focus_manager_method_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(member_expression) = call_expression.callee.as_member_expression() {
        if !member_expression
            .static_property_name()
            .is_some_and(|method_name| FOCUS_METHOD_NAMES.contains(&method_name))
        {
            return false;
        }
        let focus_manager = member_expression.object().get_inner_expression();
        return is_use_focus_manager_call(focus_manager, ctx)
            || matches!(
                focus_manager,
                Expression::Identifier(identifier)
                    if identifier_initializer(identifier, ctx)
                        .is_some_and(|initializer| is_use_focus_manager_call(initializer, ctx))
            );
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    FOCUS_METHOD_NAMES.contains(&identifier.name.as_str())
        && identifier_initializer(identifier, ctx)
            .is_some_and(|initializer| is_use_focus_manager_call(initializer, ctx))
}

fn is_use_focus_manager_call<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    imported_module_api_matches(&call_expression.callee, "useFocusManager", "ink", ctx)
}

fn identifier_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    declarator.init.as_ref()
}
