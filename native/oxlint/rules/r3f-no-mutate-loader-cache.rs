use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_LOADER_CACHE_DESTRUCTIVE_METHOD_NAMES: [&str; 11] = [
    "add",
    "applyMatrix4",
    "center",
    "clear",
    "remove",
    "removeFromParent",
    "rotateX",
    "rotateY",
    "rotateZ",
    "setValues",
    "translate",
];
const R3F_LOADER_CACHE_DESTRUCTIVE_PROPERTY_NAMES: [&str; 3] = ["geometry", "material", "parent"];
const R3F_LOADER_CACHE_MUTABLE_DESCENDANT_PROPERTY_NAMES: [&str; 11] = [
    "center",
    "color",
    "emissive",
    "normalScale",
    "offset",
    "position",
    "quaternion",
    "repeat",
    "rotation",
    "scale",
    "up",
];
const R3F_LOADER_CACHE_MUTABLE_SCALAR_PROPERTY_NAMES: [&str; 22] = [
    "anisotropy",
    "castShadow",
    "colorSpace",
    "depthTest",
    "depthWrite",
    "flipY",
    "frustumCulled",
    "intensity",
    "magFilter",
    "metalness",
    "minFilter",
    "needsUpdate",
    "opacity",
    "receiveShadow",
    "renderOrder",
    "roughness",
    "side",
    "transparent",
    "visible",
    "wireframe",
    "wrapS",
    "wrapT",
];
const R3F_LOADER_CACHE_MUTABLE_DESCENDANT_METHOD_NAMES: [&str; 7] = [
    "copy",
    "lerp",
    "lerpVectors",
    "set",
    "setScalar",
    "slerp",
    "slerpQuaternions",
];
const R3F_LOADER_CACHE_REPARENTING_METHOD_NAMES: [&str; 3] = ["add", "attach", "remove"];

#[derive(Debug, Default, Clone)]
pub struct R3FNoMutateLoaderCache;

impl RuleMeta for R3FNoMutateLoaderCache {
    const NAME: &'static str = "r3f-no-mutate-loader-cache";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow mutation of cached R3F loader assets.",
    };
}

impl Rule for R3FNoMutateLoaderCache {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    r3f_no_mutate_loader_cache_check_call(
                        node,
                        call_expression,
                        &analysis,
                        ctx,
                    );
                }
                AstKind::AssignmentExpression(assignment_expression) => {
                    r3f_no_mutate_loader_cache_check_assignment(
                        node,
                        assignment_expression,
                        &analysis,
                        ctx,
                    );
                }
                _ => {}
            }
        }
    }
}

fn r3f_no_mutate_loader_cache_check_call<'a>(
    node: &AstNode<'a>,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return;
    };
    let receiver_property_name =
        r3f_no_mutate_loader_cache_terminal_property_name(
            member_expression.object(),
            analysis,
            ctx,
        );
    let mutates_cached_receiver = (R3F_LOADER_CACHE_DESTRUCTIVE_METHOD_NAMES
        .contains(&method_name)
        || (R3F_LOADER_CACHE_MUTABLE_DESCENDANT_METHOD_NAMES.contains(&method_name)
            && receiver_property_name
                .as_deref()
                .is_some_and(|property_name| {
                    R3F_LOADER_CACHE_MUTABLE_DESCENDANT_PROPERTY_NAMES.contains(&property_name)
                })))
        && resolve_loader_cache_provenance(member_expression.object(), analysis, ctx);
    if mutates_cached_receiver {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This {method_name}() call mutates an asset shared by the R3F loader cache. Clone the loaded object or resource before mutating it"
            ))
            .with_label(node.span()),
        );
        return;
    }
    if !R3F_LOADER_CACHE_REPARENTING_METHOD_NAMES.contains(&method_name) {
        return;
    }
    for argument in &call_expression.arguments {
        let Some(argument_expression) = argument.as_expression() else {
            continue;
        };
        if resolve_loader_cache_provenance(argument_expression, analysis, ctx) {
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This reparents an object shared by the R3F loader cache. Clone the loaded object before attaching it to an imperative parent",
                )
                .with_label(argument_expression.span()),
            );
        }
    }
}

fn r3f_no_mutate_loader_cache_check_assignment<'a>(
    node: &AstNode<'a>,
    assignment_expression: &oxc_ast::ast::AssignmentExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) {
    let Some(member_expression) = assignment_expression.left.as_member_expression() else {
        return;
    };
    let Some(property_name) = member_expression.static_property_name() else {
        return;
    };
    let receiver_property_name =
        r3f_no_mutate_loader_cache_terminal_property_name(
            member_expression.object(),
            analysis,
            ctx,
        );
    if !R3F_LOADER_CACHE_DESTRUCTIVE_PROPERTY_NAMES.contains(&property_name)
        && !R3F_LOADER_CACHE_MUTABLE_SCALAR_PROPERTY_NAMES.contains(&property_name)
        && !receiver_property_name
            .as_deref()
            .is_some_and(|receiver_property_name| {
                R3F_LOADER_CACHE_MUTABLE_DESCENDANT_PROPERTY_NAMES.contains(&receiver_property_name)
            })
    {
        return;
    }
    if !resolve_loader_cache_provenance(member_expression.object(), analysis, ctx) {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This assignment mutates the {property_name} property of an asset shared by the R3F loader cache. Clone the loaded object or resource before mutating it"
        ))
        .with_label(node.span()),
    );
}

fn r3f_no_mutate_loader_cache_terminal_property_name<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let provenance = loader_cache_provenance(
        expression,
        analysis,
        ctx,
        &mut rustc_hash::FxHashSet::default(),
    )?;
    (provenance.kind == LoaderCacheProvenanceKind::Cached)
        .then_some(provenance.terminal_property_name)
        .flatten()
}
