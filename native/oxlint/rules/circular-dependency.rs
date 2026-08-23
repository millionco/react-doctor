use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct CircularDependency;

declare_oxc_lint!(
    /// Project-analysis-owned circular dependency rule.
    CircularDependency,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Project-analysis-owned circular dependency rule.",
);

impl Rule for CircularDependency {}
