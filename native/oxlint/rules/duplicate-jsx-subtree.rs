use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct DuplicateJsxSubtree;

declare_oxc_lint!(
    /// Project-analysis-owned duplicate JSX rule.
    DuplicateJsxSubtree,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Project-analysis-owned duplicate JSX rule.",
);

impl Rule for DuplicateJsxSubtree {}
