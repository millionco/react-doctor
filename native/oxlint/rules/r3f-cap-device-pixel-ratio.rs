use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const MESSAGE: &str = "This uses the device's raw pixel ratio without a cap. High-density displays can multiply the rendered pixel count; use a bounded DPR or range";

#[derive(Debug, Default, Clone)]
pub struct R3FCapDevicePixelRatio;

impl RuleMeta for R3FCapDevicePixelRatio {
    const NAME: &'static str = "r3f-cap-device-pixel-ratio";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require a cap on React Three Fiber device pixel ratios.",
    };
}

impl Rule for R3FCapDevicePixelRatio {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXOpeningElement(opening_element) if is_r3f_canvas(opening_element, ctx) => {
                    for attribute_name in ["dpr", "pixelRatio"] {
                        let Some(expression) = get_authoritative_jsx_attribute(
                            opening_element,
                            attribute_name,
                            true,
                        )
                        .and_then(|attribute| jsx_attribute_expression(attribute))
                        else {
                            continue;
                        };
                        report_raw_device_pixel_ratio(expression, ctx);
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(first_argument) = call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                    else {
                        continue;
                    };
                    if let Some(member_expression) = call_expression.callee.as_member_expression()
                        && member_expression.static_property_name() == Some("configure")
                        && is_r3f_root_receiver(
                            member_expression.object(),
                            ctx,
                            &mut Vec::new(),
                        )
                    {
                        if let Some(dpr_value) =
                            get_explicit_object_property_value(first_argument, "dpr")
                        {
                            report_raw_device_pixel_ratio(dpr_value, ctx);
                        }
                        continue;
                    }
                    let Expression::Identifier(identifier) =
                        call_expression.callee.get_inner_expression()
                    else {
                        continue;
                    };
                    if is_r3f_set_dpr_identifier(identifier, ctx, &mut Vec::new()) {
                        report_raw_device_pixel_ratio(first_argument, ctx);
                    }
                }
                _ => {}
            }
        }
    }
}

fn report_raw_device_pixel_ratio<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) {
    let Some(raw_pixel_ratio_span) = resolve_raw_device_pixel_ratio(expression, ctx) else {
        return;
    };
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(raw_pixel_ratio_span));
}

fn get_explicit_object_property_value<'a, 'b>(
    expression: &'b Expression<'a>,
    property_name: &str,
) -> Option<&'b Expression<'a>> {
    let Expression::ObjectExpression(object_expression) = expression.get_inner_expression() else {
        return None;
    };
    object_expression
        .properties
        .iter()
        .rev()
        .find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (property.kind == oxc_ast::ast::PropertyKind::Init
                && property_key_matches_name(&property.key, property_name))
            .then_some(&property.value)
        })
}

fn is_r3f_root_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_r3f_api_call(expression, "createRoot", ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
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
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("root")
        && declarator.init.as_ref().is_some_and(|initializer| {
            lazy_state_initializer_creates_r3f_root(initializer, ctx)
        })
    {
        return true;
    }
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            is_r3f_root_receiver(initializer, ctx, visited_symbol_ids)
        })
}

fn lazy_state_initializer_creates_r3f_root<'a>(
    initializer: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(use_state_call) = initializer.get_inner_expression() else {
        return false;
    };
    if !module_api_path_matches(
        &use_state_call.callee,
        &["useState"],
        &REACT_RUNTIME_MODULES,
        true,
        ctx,
    ) {
        return false;
    }
    let Some(callback_expression) = use_state_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let mut creates_root = false;
    for_each_local_callback_execution_node(callback_expression, ctx, |candidate, _| {
        if creates_root {
            return;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return;
        };
        creates_root = module_api_path_matches(
            &call_expression.callee,
            &["createRoot"],
            &R3F_PUBLIC_MODULES,
            false,
            ctx,
        );
    });
    creates_root
}

fn is_r3f_set_dpr_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
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
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some("setDpr")
        && is_r3f_api_call(initializer.get_inner_expression(), "useThree", ctx)
    {
        return true;
    }
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
    let initializer = initializer.get_inner_expression();
    if let Expression::CallExpression(call_expression) = initializer
        && use_three_selects_set_dpr(call_expression, ctx)
    {
        return true;
    }
    let Expression::Identifier(alias_identifier) = initializer else {
        return false;
    };
    is_r3f_set_dpr_identifier(alias_identifier, ctx, visited_symbol_ids)
}

fn use_three_selects_set_dpr<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !module_api_path_matches(
        &call_expression.callee,
        &["useThree"],
        &R3F_PUBLIC_MODULES,
        false,
        ctx,
    ) {
        return false;
    }
    let Some(selector_expression) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let Some(callback_id) = local_react_callback_node_id(selector_expression, ctx) else {
        return false;
    };
    function_return_expressions(callback_id, ctx).into_iter().any(|expression| {
        selector_return_selects_set_dpr(expression, callback_id, ctx)
    })
}

fn local_react_callback_node_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    use oxc_span::GetSpan;

    let (_, callback_span) = resolve_local_react_callback(expression, ctx)?;
    ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == callback_span
            && matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ))
        .then_some(candidate.id())
    })
}

fn function_return_expressions<'a>(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(function_id).kind()
        && let Some(expression) = function.get_expression()
    {
        return vec![expression];
    }
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            (local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_id))
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}

fn selector_return_selects_set_dpr<'a>(
    expression: &Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if r3f_callback_state_property_matches(expression, callback_id, "setDpr", ctx) {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional_expression) => {
            selector_return_selects_set_dpr(&conditional_expression.consequent, callback_id, ctx)
                || selector_return_selects_set_dpr(
                    &conditional_expression.alternate,
                    callback_id,
                    ctx,
                )
        }
        Expression::LogicalExpression(logical_expression) => {
            selector_return_selects_set_dpr(&logical_expression.left, callback_id, ctx)
                || selector_return_selects_set_dpr(&logical_expression.right, callback_id, ctx)
        }
        _ => false,
    }
}

fn is_r3f_api_call<'a>(
    expression: &Expression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    module_api_path_matches(
        &call_expression.callee,
        &[api_name],
        &R3F_PUBLIC_MODULES,
        false,
        ctx,
    )
}

fn binding_property_name_for_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: oxc_semantic::SymbolId,
) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(_) => None,
        BindingPattern::AssignmentPattern(assignment) => {
            binding_property_name_for_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object_pattern) => {
            for property in &object_pattern.properties {
                if binding_pattern_contains_symbol(&property.value, symbol_id) {
                    return property.key.static_name().map(|name| name.to_string());
                }
            }
            None
        }
        BindingPattern::ArrayPattern(array_pattern) => array_pattern
            .elements
            .iter()
            .flatten()
            .find_map(|element| binding_property_name_for_symbol(element, symbol_id)),
    }
}

fn binding_pattern_contains_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: oxc_semantic::SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            binding_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object_pattern) => {
            object_pattern.properties.iter().any(|property| {
                binding_pattern_contains_symbol(&property.value, symbol_id)
            }) || object_pattern.rest.as_ref().is_some_and(|rest| {
                binding_pattern_contains_symbol(&rest.argument, symbol_id)
            })
        }
        BindingPattern::ArrayPattern(array_pattern) => {
            array_pattern
                .elements
                .iter()
                .flatten()
                .any(|element| binding_pattern_contains_symbol(element, symbol_id))
                || array_pattern.rest.as_ref().is_some_and(|rest| {
                    binding_pattern_contains_symbol(&rest.argument, symbol_id)
                })
        }
    }
}
