use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct UnusedType;

declare_oxc_lint!(
    /// Project-analysis-owned unused type rule.
    UnusedType,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Project-analysis-owned unused type rule.",
);

impl Rule for UnusedType {}
