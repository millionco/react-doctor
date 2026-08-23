use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, FunctionType, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoSetStateInRender;

declare_oxc_lint!(
    /// Warns when a component unconditionally calls a useState setter while rendering.
    NoSetStateInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a component unconditionally calls a useState setter while rendering.",
);

impl Rule for NoSetStateInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::Function(function)
                if function.r#type == FunctionType::FunctionDeclaration
                    && function
                        .id
                        .as_ref()
                        .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str())) =>
            {
                if let Some(body) = &function.body {
                    check_component_statements(&body.statements, ctx);
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(component_identifier) = &declarator.id else {
                    return;
                };
                if !is_uppercase_name(component_identifier.name.as_str()) {
                    return;
                }
                let Some(initializer) = &declarator.init else {
                    return;
                };
                match initializer {
                    Expression::ArrowFunctionExpression(function) => {
                        if let Some(body) = function.body.as_function_body() {
                            check_component_statements(&body.statements, ctx);
                        }
                    }
                    Expression::FunctionExpression(function) => {
                        if let Some(body) = &function.body {
                            check_component_statements(&body.statements, ctx);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn check_component_statements<'a>(statements: &[Statement<'a>], ctx: &LintContext<'a>) {
    let setter_symbol_ids = collect_use_state_setter_symbol_ids(statements, ctx);
    if setter_symbol_ids.is_empty() {
        return;
    }
    for statement in statements {
        let Statement::ExpressionStatement(expression_statement) = statement else {
            continue;
        };
        let Expression::CallExpression(setter_call) = &expression_statement.expression else {
            continue;
        };
        let Expression::Identifier(setter_identifier) = &setter_call.callee else {
            continue;
        };
        let Some(setter_symbol_id) = ctx
            .scoping()
            .get_reference(setter_identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if !setter_symbol_ids.contains(&setter_symbol_id) {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() triggers another render while rendering. Move it to an effect or event handler, or compute the value during render.",
                setter_identifier.name,
            ))
            .with_label(setter_call.span),
        );
    }
}

fn collect_use_state_setter_symbol_ids<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
) -> Vec<oxc_semantic::SymbolId> {
    let mut setter_symbol_ids = Vec::new();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(_)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter_identifier)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !is_setter_name(setter_identifier.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
                continue;
            };
            if is_react_api_call(hook_call, "useState", ctx) {
                setter_symbol_ids.push(setter_identifier.symbol_id());
            }
        }
    }
    setter_symbol_ids
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn is_setter_name(name: &str) -> bool {
    name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase) && name.starts_with("set")
}
