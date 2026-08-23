use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct InkSuspenseRequiresConcurrent;

declare_oxc_lint!(
    /// Retired Ink Suspense rendering mode rule.
    InkSuspenseRequiresConcurrent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Retired Ink Suspense rendering mode rule.",
);

impl Rule for InkSuspenseRequiresConcurrent {}
