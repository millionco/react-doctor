use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "This pass follows OutputPass, but OutputPass performs final tone mapping and color-space conversion and must be last in the EffectComposer chain";

#[derive(Debug, Default, Clone)]
pub struct ThreeEffectComposerOutputPassLast;

declare_oxc_lint!(
    /// Require OutputPass to be the final EffectComposer pass.
    ThreeEffectComposerOutputPassLast,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require OutputPass to be the final EffectComposer pass.",
);

impl Rule for ThreeEffectComposerOutputPassLast {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut additions = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if member_expression.static_property_name() != Some("addPass")
                || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                    != Some("EffectComposer")
            {
                continue;
            }
            let Some(composer_symbol_id) =
                resolve_stable_identifier_symbol(member_expression.object(), ctx)
            else {
                continue;
            };
            let Some(pass_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let owner_node_id = crate::ast_util::get_enclosing_function(node, ctx)
                .map(AstNode::id)
                .unwrap_or(NodeId::ROOT);
            additions.push((
                node.id(),
                node.span(),
                composer_symbol_id,
                owner_node_id,
                three_constructor_api_name(pass_expression, ctx).as_deref() == Some("OutputPass"),
            ));
        }
        additions.sort_by_key(|(_, span, _, _, _)| span.start);
        let mut output_pass_pipelines = FxHashSet::default();
        for (node_id, span, composer_symbol_id, owner_node_id, is_output_pass) in additions {
            let node = ctx.nodes().get_node(node_id);
            if is_node_conditionally_executed(node, owner_node_id, ctx) {
                continue;
            }
            let pipeline_key = (composer_symbol_id, owner_node_id);
            if output_pass_pipelines.contains(&pipeline_key) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
            }
            if is_output_pass {
                output_pass_pipelines.insert(pipeline_key);
            }
        }
    }
}
