use std::collections::HashSet;

use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const ID_REFERENCE_ATTRIBUTES: [&str; 9] = [
    "aria-activedescendant",
    "aria-controls",
    "aria-describedby",
    "aria-details",
    "aria-errormessage",
    "aria-flowto",
    "aria-labelledby",
    "aria-owns",
    "htmlFor",
];

#[derive(Debug, Default, Clone)]
pub struct NoDuplicateStaticIdReference;

declare_oxc_lint!(
    /// Disallow duplicated IDs that are statically referenced by labels or ARIA relationships.
    NoDuplicateStaticIdReference,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow duplicated statically referenced IDs.",
);

impl Rule for NoDuplicateStaticIdReference {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some(opening_elements) = get_static_jsx_tree_opening_elements(node, ctx) else {
            return;
        };
        let mut id_attributes: Vec<(
            &'a str,
            Vec<&oxc_ast::ast::JSXAttribute<'a>>,
        )> = Vec::new();
        let mut referenced_ids: HashSet<&'a str> = HashSet::new();
        for opening_element in opening_elements {
            let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            if element_type.starts_with(|character: char| character.is_ascii_uppercase()) {
                continue;
            }
            if let Some(id_attribute) =
                get_authoritative_jsx_attribute(opening_element, "id", false)
                && let Some(raw_id) = get_string_literal_attribute_value(id_attribute)
            {
                let id = raw_id.trim_matches(|character| is_js_whitespace(character));
                if !id.is_empty() {
                    let id_entry = id_attributes
                        .iter_mut()
                        .find(|(existing_id, _)| *existing_id == id);
                    if let Some((_, attributes)) = id_entry {
                        attributes.push(id_attribute);
                    } else {
                        id_attributes.push((id, vec![id_attribute]));
                    }
                }
            }
            for attribute_name in ID_REFERENCE_ATTRIBUTES {
                let Some(reference_attribute) =
                    get_authoritative_jsx_attribute(opening_element, attribute_name, false)
                else {
                    continue;
                };
                let Some(reference_value) =
                    get_string_literal_attribute_value(reference_attribute)
                else {
                    continue;
                };
                referenced_ids.extend(
                    reference_value
                        .split(|character| is_js_whitespace(character))
                        .filter(|referenced_id| !referenced_id.is_empty()),
                );
            }
        }
        for (id, attributes) in id_attributes {
            if !referenced_ids.contains(id) || attributes.len() < 2 {
                continue;
            }
            for duplicate_attribute in attributes.into_iter().skip(1) {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "The referenced id \"{id}\" appears more than once in this static JSX tree, so labels and ARIA relationships can resolve to the wrong element. Make it unique."
                    ))
                    .with_label(duplicate_attribute.span),
                );
            }
        }
    }
}
