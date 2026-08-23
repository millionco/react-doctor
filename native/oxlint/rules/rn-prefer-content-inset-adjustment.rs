use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct RnPreferContentInsetAdjustment;

declare_oxc_lint!(
    /// Retired React Native content inset adjustment rule.
    RnPreferContentInsetAdjustment,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Retired React Native content inset adjustment rule.",
);

impl Rule for RnPreferContentInsetAdjustment {}
