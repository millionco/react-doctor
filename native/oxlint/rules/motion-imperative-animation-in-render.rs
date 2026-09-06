use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const ANIMATION_CONTROL_HOOKS: [&str; 2] = ["useAnimation", "useAnimationControls"];
const MOTION_VALUE_HOOKS: [&str; 5] = [
    "useMotionValue",
    "useSpring",
    "useTime",
    "useTransform",
    "useVelocity",
];

#[derive(Debug, Default, Clone)]
pub struct MotionImperativeAnimationInRender;

declare_oxc_lint!(
    /// Disallow imperative Motion animations during render.
    MotionImperativeAnimationInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow imperative Motion animations during render.",
);

impl Rule for MotionImperativeAnimationInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(animation_kind) = imperative_animation_kind(call_expression, ctx) else {
            return;
        };
        if !is_render_phase_component_or_hook(node, ctx) {
            return;
        }
        let operation = match animation_kind {
            ImperativeAnimationKind::Animate => "This imperative animation",
            ImperativeAnimationKind::Controls => "Animation controls start",
            ImperativeAnimationKind::MotionValue => "This Motion value write",
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{operation} during render, so React retries and re-renders can replay the side effect. Move it to an effect or event handler."
            ))
            .with_label(call_expression.span),
        );
    }
}

enum ImperativeAnimationKind {
    Animate,
    Controls,
    MotionValue,
}

fn imperative_animation_kind<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<ImperativeAnimationKind> {
    if motion_react_api_path_matches(&call_expression.callee, &["animate"], ctx)
        || is_use_animate_function(&call_expression.callee, ctx, &mut Vec::new())
    {
        return Some(ImperativeAnimationKind::Animate);
    }
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    match member_expression.static_property_name()? {
        "start"
            if is_motion_hook_result_expression(
                member_expression.object(),
                &ANIMATION_CONTROL_HOOKS,
                ctx,
            ) =>
        {
            Some(ImperativeAnimationKind::Controls)
        }
        "set" | "jump"
            if is_motion_hook_result_expression(
                member_expression.object(),
                &MOTION_VALUE_HOOKS,
                ctx,
            ) =>
        {
            Some(ImperativeAnimationKind::MotionValue)
        }
        _ => None,
    }
}

fn is_use_animate_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && let Some(initializer) = &declarator.init
        && matches!(
            initializer.get_inner_expression(),
            Expression::Identifier(_)
        )
    {
        return is_use_animate_function(initializer, ctx, visited_symbol_ids);
    }
    let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
        return false;
    };
    let Some(Some(BindingPattern::BindingIdentifier(animate_binding))) =
        array_pattern.elements.get(1)
    else {
        return false;
    };
    if animate_binding.symbol_id() != symbol_id {
        return false;
    }
    let Some(Expression::CallExpression(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    motion_react_api_path_matches(&initializer.callee, &["useAnimate"], ctx)
}
