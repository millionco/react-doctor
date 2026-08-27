use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    AstNode,
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
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return;
        };
        if member_expression.static_property_name() == Some("dispose")
            && resolve_loader_cache_provenance(member_expression.object(), ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
        }
    }
}
