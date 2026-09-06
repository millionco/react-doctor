use oxc_diagnostics::OxcDiagnostic;

use crate::rule::{Rule, RuleCategory, RuleInfo, RuleMeta};

const MESSAGE: &str = "This React state update can schedule a component render every frame. Mutate a Three.js ref or transient store, or guard an infrequent state transition";
const R3F_STATE_IN_FRAME_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoStateInUseFrame;

impl RuleMeta for R3FNoStateInUseFrame {
    const NAME: &'static str = "r3f-no-state-in-use-frame";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow React state updates inside useFrame.",
    };
}

impl Rule for R3FNoStateInUseFrame {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut transition_cache = R3fStateTransitionCache::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_STATE_IN_FRAME_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_STATE_IN_FRAME_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, root_callback_id, _, _| {
                    let AstKind::CallExpression(setter_call) = candidate.kind() else {
                        return;
                    };
                    if r3f_state_cached_setter_binding(
                        candidate,
                        setter_call,
                        &analysis,
                        &mut transition_cache,
                        ctx,
                    )
                    .is_none()
                        || r3f_is_guarded_state_transition(
                            candidate,
                            root_callback_id,
                            &analysis,
                            &node_index,
                            &mut transition_cache,
                            ctx,
                        )
                    {
                        return;
                    }
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}
