use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MUTABLE_ROOT_STATE_PROPERTIES: [&str; 8] = [
    "camera",
    "clock",
    "gl",
    "mouse",
    "pointer",
    "raycaster",
    "renderer",
    "scene",
];
const MUTABLE_SCALAR_PROPERTY_NAMES: [&str; 27] = [
    "aspect",
    "autoClear",
    "autoClearColor",
    "autoClearDepth",
    "autoClearStencil",
    "backgroundBlurriness",
    "backgroundIntensity",
    "elapsedTime",
    "environmentIntensity",
    "far",
    "filmGauge",
    "filmOffset",
    "focus",
    "fov",
    "near",
    "oldTime",
    "outputColorSpace",
    "running",
    "sortObjects",
    "startTime",
    "toneMapping",
    "toneMappingExposure",
    "w",
    "x",
    "y",
    "z",
    "zoom",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoDeepUseThreeSelector;

impl RuleMeta for R3FNoDeepUseThreeSelector {
    const NAME: &'static str = "r3f-no-deep-use-three-selector";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow selecting mutable Three.js fields with useThree.",
    };
}

impl Rule for R3FNoDeepUseThreeSelector {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_path_matches(
                &call_expression.callee,
                &["useThree"],
                &R3F_PUBLIC_MODULES,
                false,
                ctx,
            ) {
                continue;
            }
            let Some(selector_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(selector_id) = r3f_deep_selector_callback_node_id(selector_expression, ctx)
            else {
                continue;
            };
            for returned_expression in r3f_deep_selector_return_expressions(selector_id, ctx) {
                let Some((mutable_property_name, root_property_name)) =
                    r3f_deep_mutable_state_property(returned_expression, selector_id, ctx)
                else {
                    continue;
                };
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This selector reads the mutable {mutable_property_name} field from {root_property_name}, but deep Three.js mutations do not update the R3F store. Select {root_property_name} itself and read {mutable_property_name} at the point of use"
                    ))
                    .with_label(returned_expression.span()),
                );
            }
        }
    }
}

fn r3f_deep_mutable_state_property<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    selector_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Option<(&'a str, &'static str)> {
    let member_expression = expression.get_inner_expression().as_member_expression()?;
    let mutable_property_name = member_expression.static_property_name()?;
    if !MUTABLE_SCALAR_PROPERTY_NAMES.contains(&mutable_property_name) {
        return None;
    }
    let mut candidate = member_expression.object().get_inner_expression();
    loop {
        if let Some(root_property_name) =
            MUTABLE_ROOT_STATE_PROPERTIES
                .iter()
                .find(|root_property_name| {
                    r3f_callback_state_property_matches(
                        candidate,
                        selector_id,
                        root_property_name,
                        ctx,
                    )
                })
        {
            return Some((mutable_property_name, root_property_name));
        }
        candidate = candidate
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
}

fn r3f_deep_selector_callback_node_id<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
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

fn r3f_deep_selector_return_expressions<'a>(
    selector_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Vec<&'a oxc_ast::ast::Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(function) = ctx.nodes().get_node(selector_id).kind()
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
            (local_callback_nearest_function_id(candidate.id(), ctx) == Some(selector_id))
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}
