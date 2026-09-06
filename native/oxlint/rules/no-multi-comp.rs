mod no_multi_component_file_impl {
    include!("no_multi_component_file.rs");
}

use no_multi_component_file_impl::{MultiComponentCandidate, multi_component_candidates};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const NO_MULTI_COMP_MESSAGE: &str = "Declare only one React component per file.";

#[derive(Debug, Default, Clone)]
pub struct NoMultiComp;

declare_oxc_lint!(
    /// Disallow multiple React components in one file.
    NoMultiComp,
    react_doctor_native,
    nursery,
    version = "0.1.0",
    short_description = "Disallow multiple React components in one file.",
);

impl Rule for NoMultiComp {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let ignore_stateless = ctx
            .settings()
            .json
            .as_ref()
            .and_then(|settings| settings.get("react-doctor"))
            .and_then(serde_json::Value::as_object)
            .and_then(|settings| settings.get("noMultiComp"))
            .and_then(serde_json::Value::as_object)
            .and_then(|settings| settings.get("ignoreStateless"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let mut candidates = multi_component_candidates(ctx);
        candidates
            .sort_unstable_by_key(|candidate| (candidate.body_span.start, candidate.body_span.end));
        let mut top_level = Vec::<MultiComponentCandidate>::new();
        for candidate in candidates {
            if top_level.last().is_some_and(|parent| {
                parent.body_span != candidate.body_span
                    && parent.body_span.contains_inclusive(candidate.body_span)
            }) {
                continue;
            }
            top_level.push(candidate);
        }
        if ignore_stateless {
            top_level.retain(|candidate| !candidate.is_stateless);
        }
        for component in top_level.iter().skip(1) {
            ctx.diagnostic(OxcDiagnostic::warn(NO_MULTI_COMP_MESSAGE).with_label(component.span));
        }
    }
}
