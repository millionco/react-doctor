use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct UnusedExport;

declare_oxc_lint!(
    /// Project-analysis-owned unused export rule.
    UnusedExport,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Project-analysis-owned unused export rule.",
);

impl Rule for UnusedExport {}
