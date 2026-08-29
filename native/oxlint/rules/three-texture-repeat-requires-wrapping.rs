use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const THREE_TEXTURE_CONSTRUCTOR_NAMES: [&str; 9] = [
    "CanvasTexture",
    "CompressedTexture",
    "Data3DTexture",
    "DataArrayTexture",
    "DataTexture",
    "DepthTexture",
    "FramebufferTexture",
    "Texture",
    "VideoTexture",
];
const THREE_TEXTURE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeTextureRepeatRequiresWrapping;

impl RuleMeta for ThreeTextureRepeatRequiresWrapping {
    const NAME: &'static str = "three-texture-repeat-requires-wrapping";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require repeat wrapping for repeated Three.js textures.",
    };
}

struct ThreeTextureWrappingFact {
    axis: &'static str,
    node_id: NodeId,
    owner_function_id: Option<NodeId>,
    texture_key: String,
}

impl Rule for ThreeTextureRepeatRequiresWrapping {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut wrapping_facts = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign =>
                {
                    let Some(target) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    let Some(axis) = (match static_member_expression_property_name(target) {
                        Some("wrapS") => Some("x"),
                        Some("wrapT") => Some("y"),
                        _ => None,
                    }) else {
                        continue;
                    };
                    if !three_texture_is_repeating_wrapping(&assignment.right, &analysis, ctx) {
                        continue;
                    }
                    let Some(texture_key) =
                        resolve_expression_key(target.object(), ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    wrapping_facts.push(ThreeTextureWrappingFact {
                        axis,
                        node_id: node.id(),
                        owner_function_id: local_callback_nearest_function_id(node.id(), ctx),
                        texture_key,
                    });
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(callee) = call_expression
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        continue;
                    };
                    if static_member_expression_property_name(callee) != Some("set") {
                        continue;
                    }
                    let Some(repeat_member) = callee
                        .object()
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        continue;
                    };
                    if static_member_expression_property_name(repeat_member) != Some("repeat")
                        || three_constructor_name(
                            repeat_member.object(),
                            &THREE_TEXTURE_CONSTRUCTOR_NAMES,
                            ctx,
                        )
                        .is_none()
                    {
                        continue;
                    }
                    let Some(texture_key) =
                        resolve_expression_key(repeat_member.object(), ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    let owner_function_id = local_callback_nearest_function_id(node.id(), ctx);
                    for (axis, argument_index, wrapping_name) in
                        [("x", 0, "wrapS"), ("y", 1, "wrapT")]
                    {
                        let Some(expression) = call_expression
                            .arguments
                            .get(argument_index)
                            .and_then(oxc_ast::ast::Argument::as_expression)
                        else {
                            continue;
                        };
                        if resolve_static_number(expression, ctx).is_none_or(|value| value <= 1.0) {
                            continue;
                        }
                        let has_wrapping = wrapping_facts.iter().any(|fact| {
                            fact.axis == axis
                                && fact.texture_key == texture_key
                                && fact.owner_function_id == owner_function_id
                                && ctx.nodes().get_node(fact.node_id).span().start
                                    < node.span().start
                        });
                        if has_wrapping {
                            continue;
                        }
                        ctx.diagnostic(
                            OxcDiagnostic::warn(format!(
                                "texture.repeat.{axis} is greater than one, but the corresponding {wrapping_name} remains ClampToEdgeWrapping so the texture will not tile on that axis"
                            ))
                            .with_label(expression.span()),
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn three_texture_is_repeating_wrapping<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    ["MirroredRepeatWrapping", "RepeatWrapping"]
        .into_iter()
        .any(|wrapping_name| {
            module_api_reference_matches(
                expression,
                wrapping_name,
                &THREE_TEXTURE_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                expression,
                wrapping_name,
                &THREE_TEXTURE_MODULES,
                analysis,
                ctx,
            )
        })
}
