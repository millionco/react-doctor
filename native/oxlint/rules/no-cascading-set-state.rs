use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct NoCascadingSetState;

declare_oxc_lint!(
    /// Retired cascading setState rule.
    NoCascadingSetState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Retired cascading setState rule.",
);

impl Rule for NoCascadingSetState {}
