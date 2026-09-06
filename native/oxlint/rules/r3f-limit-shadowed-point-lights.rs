use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use rustc_hash::FxHashMap;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
    AstNode,
};

const MAX_SHADOWED_POINT_LIGHT_COUNT: u32 = 2;
const MESSAGE: &str = "This is the third or later shadow-casting point light in the same returned scene. Each point-light shadow renders six cube faces, multiplying shadow passes";

#[derive(Debug, Default, Clone)]
pub struct R3FLimitShadowedPointLights;

impl RuleMeta for R3FLimitShadowedPointLights {
    const NAME: &'static str = "r3f-limit-shadowed-point-lights";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Limit shadow-casting point lights in one returned R3F scene.",
    };
}

impl Rule for R3FLimitShadowedPointLights {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        let mut point_light_count_by_root = FxHashMap::<NodeId, u32>::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !is_statically_shadowed_point_light(opening_element, ctx) {
                continue;
            }
            let Some(returned_root_node_id) = returned_jsx_root_node_id(node, ctx) else {
                continue;
            };
            if has_dynamic_branch_before_root(node, returned_root_node_id, ctx) {
                continue;
            }
            let point_light_count = point_light_count_by_root
                .entry(returned_root_node_id)
                .or_default();
            *point_light_count += 1;
            if *point_light_count > MAX_SHADOWED_POINT_LIGHT_COUNT {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
            }
        }
    }
}

fn is_statically_shadowed_point_light<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
        return false;
    };
    if identifier.name != "pointLight"
        || opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        })
    {
        return false;
    }
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "castShadow", true)
    else {
        return false;
    };
    let Some(value) = &attribute.value else {
        return true;
    };
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return false;
    };
    container
        .expression
        .as_expression()
        .is_some_and(|expression| resolves_to_true(expression, ctx, &mut Vec::new()))
}

fn resolves_to_true<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
    ) {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
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
    matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| resolves_to_true(initializer, ctx, visited_symbol_ids))
}

fn returned_jsx_root_node_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    let mut returned_root_node_id = None;
    let mut is_inside_return = false;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => {
                returned_root_node_id = Some(ancestor.id());
            }
            AstKind::ReturnStatement(_) => is_inside_return = true,
            AstKind::ArrowFunctionExpression(arrow_function) => {
                return (is_inside_return || arrow_function.get_expression().is_some())
                    .then_some(returned_root_node_id)
                    .flatten();
            }
            AstKind::Function(_) => {
                return is_inside_return.then_some(returned_root_node_id).flatten();
            }
            _ => {}
        }
    }
    None
}

fn has_dynamic_branch_before_root(
    node: &AstNode<'_>,
    returned_root_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == returned_root_node_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_)
        ) {
            return true;
        }
    }
    false
}
