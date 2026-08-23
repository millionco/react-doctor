use oxc_macros::declare_oxc_lint;

use crate::rule::Rule;

#[derive(Debug, Default, Clone)]
pub struct InkNewlineInsideText;

declare_oxc_lint!(
    /// Retired Ink Newline placement rule.
    InkNewlineInsideText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Retired Ink Newline placement rule.",
);

impl Rule for InkNewlineInsideText {}
