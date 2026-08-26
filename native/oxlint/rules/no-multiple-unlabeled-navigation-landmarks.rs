use oxc_ast::{AstKind, ast::JSXAttributeItem};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This navigation landmark is indistinguishable from another landmark in the same view. Give each one a unique accessible name.";

#[derive(Debug, Default, Clone)]
pub struct NoMultipleUnlabeledNavigationLandmarks;

declare_oxc_lint!(
    /// Require unique accessible names for coexisting navigation landmarks.
    NoMultipleUnlabeledNavigationLandmarks,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require unique accessible names for navigation landmarks.",
);

impl Rule for NoMultipleUnlabeledNavigationLandmarks {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut landmarks_by_root =
            Vec::<(NodeId, Vec<&oxc_ast::ast::JSXOpeningElement<'_>>)>::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !resolve_jsx_element_type(opening_element, ctx)
                .is_some_and(|(element_type, _)| element_type == "nav")
            {
                continue;
            }
            let Some(root_id) = get_static_jsx_tree_root_id(node.id(), ctx) else {
                continue;
            };
            if let Some((_, landmarks)) = landmarks_by_root
                .iter_mut()
                .find(|(candidate_root_id, _)| *candidate_root_id == root_id)
            {
                landmarks.push(opening_element);
            } else {
                landmarks_by_root.push((root_id, vec![opening_element]));
            }
        }

        for (_, landmarks) in landmarks_by_root {
            if landmarks.len() < 2 {
                continue;
            }

            let mut conflicting_landmarks = Vec::new();
            for first_index in 0..landmarks.len() {
                let first_landmark = landmarks[first_index];
                let first_name = get_landmark_name(first_landmark);
                for second_landmark in &landmarks[first_index + 1..] {
                    if !can_landmarks_coexist(first_landmark, second_landmark, ctx) {
                        continue;
                    }
                    let second_name = get_landmark_name(second_landmark);
                    if matches!(first_name, LandmarkName::Unknown)
                        || matches!(second_name, LandmarkName::Unknown)
                    {
                        continue;
                    }
                    if matches!(first_name, LandmarkName::Unnamed) {
                        add_conflicting_landmark(&mut conflicting_landmarks, first_landmark);
                    }
                    if matches!(second_name, LandmarkName::Unnamed) {
                        add_conflicting_landmark(&mut conflicting_landmarks, second_landmark);
                    }
                    if let (LandmarkName::Named(first_name), LandmarkName::Named(second_name)) =
                        (first_name, second_name)
                        && first_name.to_lowercase() == second_name.to_lowercase()
                    {
                        add_conflicting_landmark(&mut conflicting_landmarks, second_landmark);
                    }
                }
            }
            for landmark in conflicting_landmarks {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(landmark.span));
            }
        }
    }
}

#[derive(Clone, Copy)]
enum LandmarkName<'a> {
    Unknown,
    Unnamed,
    Named(&'a str),
}

struct LandmarkPlacement {
    opaque_boundary: Option<NodeId>,
    visibility: Vec<bool>,
}

fn get_static_jsx_tree_root_id(
    opening_element_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let mut root_id = None;
    for ancestor in ctx.nodes().ancestors(opening_element_node_id) {
        match ancestor.kind() {
            AstKind::JSXExpressionContainer(_) => return None,
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => root_id = Some(ancestor.id()),
            _ => {}
        }
    }
    root_id
}

fn get_landmark_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> LandmarkName<'a> {
    for attribute_name in ["aria-label", "aria-labelledby"] {
        let Some(attribute) = find_jsx_attribute(opening_element, attribute_name) else {
            continue;
        };
        return get_string_literal_attribute_value(attribute)
            .map_or(LandmarkName::Unknown, LandmarkName::Named);
    }
    if opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        LandmarkName::Unknown
    } else {
        LandmarkName::Unnamed
    }
}

fn get_element_visibility(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> Option<Vec<bool>> {
    let Some(class_name_attribute) = find_jsx_attribute(opening_element, "className") else {
        return get_tailwind_visibility_at_breakpoints("");
    };
    get_string_literal_attribute_value(class_name_attribute)
        .and_then(get_tailwind_visibility_at_breakpoints)
}

fn get_landmark_placement(
    landmark: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> Option<LandmarkPlacement> {
    let mut combined_visibility = get_element_visibility(landmark)?;
    for ancestor in ctx.nodes().ancestors(landmark.node_id.get()).skip(2) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let first_character = resolve_jsx_element_type(&element.opening_element, ctx)
            .and_then(|(element_type, _)| element_type.chars().next())
            .or_else(|| {
                ctx.source_range(element.opening_element.name.span())
                    .chars()
                    .next()
            });
        let is_intrinsic = first_character.is_some_and(|first_character| {
            first_character.to_lowercase().to_string() == first_character.to_string()
        });
        if !is_intrinsic {
            return Some(LandmarkPlacement {
                opaque_boundary: Some(ancestor.id()),
                visibility: combined_visibility,
            });
        }
        let ancestor_visibility = get_element_visibility(&element.opening_element)?;
        for (combined_value, ancestor_value) in
            combined_visibility.iter_mut().zip(ancestor_visibility)
        {
            *combined_value = *combined_value && ancestor_value;
        }
    }
    Some(LandmarkPlacement {
        opaque_boundary: None,
        visibility: combined_visibility,
    })
}

fn can_landmarks_coexist(
    first_landmark: &oxc_ast::ast::JSXOpeningElement<'_>,
    second_landmark: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(first_placement) = get_landmark_placement(first_landmark, ctx) else {
        return false;
    };
    let Some(second_placement) = get_landmark_placement(second_landmark, ctx) else {
        return false;
    };
    first_placement.opaque_boundary == second_placement.opaque_boundary
        && first_placement
            .visibility
            .iter()
            .zip(second_placement.visibility)
            .any(|(is_first_visible, is_second_visible)| {
                *is_first_visible && is_second_visible
            })
}

fn add_conflicting_landmark<'a>(
    conflicting_landmarks: &mut Vec<&'a oxc_ast::ast::JSXOpeningElement<'a>>,
    landmark: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) {
    if conflicting_landmarks
        .iter()
        .any(|candidate| candidate.node_id.get() == landmark.node_id.get())
    {
        return;
    }
    conflicting_landmarks.push(landmark);
}
