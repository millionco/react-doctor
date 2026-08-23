use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct RnAnimateLayoutProperty;

declare_oxc_lint!(
    /// Retired React Native layout animation rule.
    RnAnimateLayoutProperty,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Retired React Native layout animation rule.",
);

impl Rule for RnAnimateLayoutProperty {}
