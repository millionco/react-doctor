use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This disposes an asset shared by the R3F loader cache, which can break other consumers of the same asset. Leave cached loader assets managed by the cache";

#[derive(Debug, Default, Clone)]
pub struct R3FNoDisposeLoaderCache;

impl RuleMeta for R3FNoDisposeLoaderCache {
    const NAME: &'static str = "r3f-no-dispose-loader-cache";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow disposal of cached R3F loader assets.",
    };
}

impl Rule for R3FNoDisposeLoaderCache {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            if member_expression.static_property_name() == Some("dispose")
                && resolve_loader_cache_provenance(member_expression.object(), &analysis, ctx)
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
            }
        }
    }
}
