use oxc_ast::{
    ast::{BindingPattern, Expression, ObjectPropertyKind},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const CHILD_PROCESS_METHOD_NAMES: [&str; 4] = ["exec", "execFile", "spawn", "spawnSync"];
const CHILD_PROCESS_MODULE_NAMES: [&str; 2] = ["child_process", "node:child_process"];
const MESSAGE: &str =
    "Suspend Ink before giving an interactive child process control of the terminal.";

#[derive(Debug, Default, Clone)]
pub struct InkUseSuspendTerminal;

declare_oxc_lint!(
    /// Require Ink terminal suspension around inherited-TTY child processes.
    InkUseSuspendTerminal,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Ink terminal suspension for interactive child processes.",
);

impl Rule for InkUseSuspendTerminal {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(child_process_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = child_process_call.callee.get_inner_expression()
        else {
            return;
        };
        if !is_imported_child_process_method(callee, ctx)
            || !child_process_call
                .arguments
                .iter()
                .any(|argument| argument.as_expression().is_some_and(has_inherited_stdio))
            || is_inside_suspend_terminal(node, ctx)
            || !is_inside_use_input_handler(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(child_process_call.span));
    }
}

fn is_imported_child_process_method<'a>(
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
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && CHILD_PROCESS_MODULE_NAMES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if CHILD_PROCESS_METHOD_NAMES.contains(&imported_name.name())
            )
    })
}

fn has_inherited_stdio(expression: &Expression<'_>) -> bool {
    let Expression::ObjectExpression(options) = expression.get_inner_expression() else {
        return false;
    };
    options.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        property.key.static_name().as_deref() == Some("stdio")
            && matches!(
                property.value.get_inner_expression(),
                Expression::StringLiteral(value) if value.value == "inherit"
            )
    })
}

fn is_inside_suspend_terminal(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::CallExpression(call_expression)
                if is_suspend_terminal_call(call_expression, ctx)
        )
    })
}

fn is_suspend_terminal_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(member_expression) = call_expression.callee.as_member_expression() {
        return member_expression.static_property_name() == Some("suspendTerminal")
            && is_use_app_call(member_expression.object(), ctx);
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
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
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    let has_suspend_terminal_binding = pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some("suspendTerminal")
            && matches!(
                &property.value,
                BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id
            )
    });
    has_suspend_terminal_binding
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| is_use_app_call(initializer, ctx))
}

fn is_use_app_call<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::CallExpression(call_expression)
            if imported_module_api_matches(&call_expression.callee, "useApp", "ink", ctx)
    )
}

fn is_inside_use_input_handler<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(handler_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    let handler_parent = ctx.nodes().parent_node(handler_function.id());
    let AstKind::CallExpression(use_input_call) = handler_parent.kind() else {
        return false;
    };
    use_input_call.arguments.first().is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == handler_function.span())
    }) && imported_module_api_matches(&use_input_call.callee, "useInput", "ink", ctx)
}
