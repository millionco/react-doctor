use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This clone allocates a new Three.js object every executed frame. Reuse a scratch object or clone once outside useFrame";
const CLONEABLE_STATE_PROPERTIES: [&str; 5] = ["camera", "mouse", "pointer", "raycaster", "scene"];
const THREE_OBJECT_MEMBER_PROPERTIES: [&str; 9] = [
    "color",
    "geometry",
    "material",
    "matrix",
    "matrixWorld",
    "position",
    "quaternion",
    "rotation",
    "scale",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoCloneInUseFrame;

impl RuleMeta for R3FNoCloneInUseFrame {
    const NAME: &'static str = "r3f-no-clone-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow Three.js object cloning inside useFrame.",
    };
}

impl Rule for R3FNoCloneInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let managed_ref_symbol_ids = collect_r3f_host_ref_symbol_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            for_each_r3f_callback_execution_node(
                call_expression,
                "useFrame",
                ctx,
                |candidate, callback_id, is_conditionally_executed| {
                    if is_conditionally_executed {
                        return;
                    }
                    let AstKind::CallExpression(clone_call) = candidate.kind() else {
                        return;
                    };
                    let Some(clone_member) = clone_call.callee.as_member_expression() else {
                        return;
                    };
                    if clone_member.static_property_name() == Some("clone")
                        && r3f_clone_receiver_has_three_object_provenance(
                            clone_member.object(),
                            callback_id,
                            &managed_ref_symbol_ids,
                            ctx,
                            &mut Vec::new(),
                        )
                    {
                        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                    }
                },
            );
        }
    }
}

fn r3f_clone_receiver_has_three_object_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut has_three_object_member = false;
    while let Some(member_expression) = current.as_member_expression() {
        let property_name = member_expression.static_property_name();
        if property_name.is_some_and(|name| THREE_OBJECT_MEMBER_PROPERTIES.contains(&name)) {
            has_three_object_member = true;
        }
        if (has_three_object_member || property_name == Some("current"))
            && r3f_react_ref_symbol(member_expression, ctx)
                .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
        {
            return true;
        }
        current = member_expression.object().get_inner_expression();
    }
    if let oxc_ast::ast::Expression::Identifier(identifier) = current
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == r3f_callback_parameter_symbol(callback_id, ctx)
    {
        return true;
    }
    if CLONEABLE_STATE_PROPERTIES.iter().any(|property_name| {
        r3f_callback_state_property_matches(current, callback_id, property_name, ctx)
    }) || CLONEABLE_STATE_PROPERTIES
        .iter()
        .any(|property_name| r3f_use_three_state_property_matches(current, property_name, ctx))
    {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = current else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    declarator.init.as_ref().is_some_and(|initializer| {
        r3f_clone_receiver_has_three_object_provenance(
            initializer,
            callback_id,
            managed_ref_symbol_ids,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn r3f_react_ref_symbol<'a>(
    member_expression: &oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    let mut current = member_expression;
    loop {
        if current.static_property_name() == Some("current") {
            let oxc_ast::ast::Expression::Identifier(identifier) =
                current.object().get_inner_expression()
            else {
                return None;
            };
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            return r3f_symbol_is_react_ref(symbol_id, ctx).then_some(symbol_id);
        }
        current = current.object().as_member_expression()?;
    }
}

fn r3f_symbol_is_react_ref(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(oxc_ast::ast::Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return false;
    };
    is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx)
}
