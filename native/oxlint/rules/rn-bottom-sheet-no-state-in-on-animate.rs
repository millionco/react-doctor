use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

const BOTTOM_SHEET_MODULE_SOURCE: &str = "@gorhom/bottom-sheet";
const BOTTOM_SHEET_CONTAINER_NAMES: [&str; 3] = ["BottomSheet", "BottomSheetModal", "default"];
const MESSAGE: &str = "This onAnimate handler starts a React state update as the Bottom Sheet begins moving, adding render work to the transition. Use animatedIndex or animatedPosition for animation-coupled UI.";

#[derive(Debug, Default, Clone)]
pub struct RnBottomSheetNoStateInOnAnimate;

declare_oxc_lint!(
    /// Disallow React state updates inside Bottom Sheet onAnimate handlers.
    RnBottomSheetNoStateInOnAnimate,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React state updates inside Bottom Sheet onAnimate handlers.",
);

impl Rule for RnBottomSheetNoStateInOnAnimate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(component_name) = resolve_imported_jsx_component_name(
                opening_element,
                BOTTOM_SHEET_MODULE_SOURCE,
                ctx,
            ) else {
                continue;
            };
            if !BOTTOM_SHEET_CONTAINER_NAMES.contains(&component_name) {
                continue;
            }
            let Some(handler_expression) =
                find_jsx_attribute(opening_element, "onAnimate").and_then(jsx_attribute_expression)
            else {
                continue;
            };
            let Some(handler_id) =
                rn_on_animate_exact_local_function_id(handler_expression, ctx, &mut Vec::new())
            else {
                continue;
            };
            let Some(setter_call) = ctx.nodes().iter().find(|candidate| {
                let AstKind::CallExpression(call_expression) = candidate.kind() else {
                    return false;
                };
                local_callback_nearest_function_id(candidate.id(), ctx) == Some(handler_id)
                    && rn_on_animate_is_use_state_setter(&call_expression.callee, ctx)
            }) else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(setter_call.span()));
        }
    }
}

fn rn_on_animate_exact_local_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_)
                    if !ctx
                        .scoping()
                        .get_resolved_references(symbol_id)
                        .any(oxc_semantic::Reference::is_write) =>
                {
                    Some(declaration.id())
                }
                AstKind::VariableDeclarator(declarator)
                    if matches!(
                        ctx.nodes().parent_node(declaration.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) && declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
                {
                    rn_on_animate_exact_local_function_id(
                        declarator.init.as_ref()?,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn rn_on_animate_is_use_state_setter<'a>(callee: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return false;
    };
    let Some(setter_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if !matches!(
        pattern.elements.get(1).and_then(Option::as_ref),
        Some(BindingPattern::BindingIdentifier(binding))
            if binding.symbol_id() == setter_symbol_id
    ) {
        return false;
    }
    let Some(Expression::CallExpression(use_state_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    is_react_hook_call(use_state_call, &["useState"], ctx)
}
