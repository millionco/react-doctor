use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct UnusedDevDependency;

declare_oxc_lint!(
    /// Project-analysis-owned unused development dependency rule.
    UnusedDevDependency,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Project-analysis-owned unused development dependency rule.",
);

impl Rule for UnusedDevDependency {}
