use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const ALLOCATABLE_EVENT_PROPERTIES: [&str; 6] =
    ["eventObject", "normal", "object", "point", "ray", "uv"];
const CONSTRUCTOR_MESSAGE: &str =
    "This constructor allocates on every pointer movement. Reuse an object created outside the handler";
const CLONE_MESSAGE: &str =
    "This clone allocates a Three.js object on every pointer movement. Copy into a reusable object instead";

#[derive(Debug, Default, Clone)]
pub struct R3FNoAllocationInPointerMove;

impl RuleMeta for R3FNoAllocationInPointerMove {
    const NAME: &'static str = "r3f-no-allocation-in-pointer-move";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow allocations inside React Three Fiber pointer-move handlers.",
    };
}

impl Rule for R3FNoAllocationInPointerMove {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(handler_expression) =
                r3f_jsx_event_handler_expression(opening_element, "onPointerMove", ctx)
            else {
                continue;
            };
            for_each_local_callback_execution_node(
                handler_expression,
                ctx,
                |candidate, handler_id, is_conditionally_executed| {
                    if is_conditionally_executed {
                        return;
                    }
                    if matches!(candidate.kind(), AstKind::NewExpression(_)) {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(CONSTRUCTOR_MESSAGE)
                                .with_label(candidate.span()),
                        );
                        return;
                    }
                    let AstKind::CallExpression(call_expression) = candidate.kind() else {
                        return;
                    };
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        return;
                    };
                    if member_expression.static_property_name() == Some("clone")
                        && has_r3f_event_object_provenance(
                            member_expression.object(),
                            handler_id,
                            ctx,
                        )
                    {
                        ctx.diagnostic(
                            OxcDiagnostic::warn(CLONE_MESSAGE).with_label(candidate.span()),
                        );
                    }
                },
            );
        }
    }
}

fn has_r3f_event_object_provenance<'a>(
    expression: &Expression<'a>,
    handler_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut candidate = expression.get_inner_expression();
    loop {
        if ALLOCATABLE_EVENT_PROPERTIES.iter().any(|property_name| {
            r3f_callback_state_property_matches(candidate, handler_id, property_name, ctx)
        }) {
            return true;
        }
        let Some(member_expression) = candidate.as_member_expression() else {
            return false;
        };
        candidate = member_expression.object().get_inner_expression();
    }
}
