use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This spring mixes physics controls with duration-based controls, so Motion ignores duration and bounce. Keep only one spring configuration mode.";
const PHYSICS_PROPERTY_NAMES: [&str; 3] = ["stiffness", "damping", "mass"];
const DURATION_PROPERTY_NAMES: [&str; 2] = ["duration", "bounce"];

#[derive(Debug, Default, Clone)]
pub struct NoConflictingSpringOptions;

declare_oxc_lint!(
    /// Disallow Motion spring options from incompatible control modes.
    NoConflictingSpringOptions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow conflicting Motion spring options.",
);

impl Rule for NoConflictingSpringOptions {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        for transition_object in get_static_motion_transition_objects(opening_element, ctx) {
            let Some(type_property) =
                get_effective_motion_object_property(transition_object, "type")
            else {
                continue;
            };
            let oxc_ast::ast::Expression::StringLiteral(spring_type) = &type_property.value else {
                continue;
            };
            if spring_type.value != "spring"
                || !PHYSICS_PROPERTY_NAMES.iter().any(|property_name| {
                    get_effective_motion_object_property(transition_object, property_name).is_some()
                })
            {
                continue;
            }
            let Some(duration_property) =
                DURATION_PROPERTY_NAMES.iter().find_map(|property_name| {
                    get_effective_motion_object_property(transition_object, property_name)
                })
            else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(duration_property.span));
        }
    }
}
