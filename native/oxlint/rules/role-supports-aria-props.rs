use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::LintContext,
    globals::{VALID_ARIA_ROLES, is_valid_aria_property},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const GLOBAL_ARIA_PROPERTIES: &[&str] = &[
    "aria-atomic",
    "aria-braillelabel",
    "aria-brailleroledescription",
    "aria-busy",
    "aria-controls",
    "aria-current",
    "aria-describedby",
    "aria-description",
    "aria-details",
    "aria-disabled",
    "aria-dropeffect",
    "aria-errormessage",
    "aria-flowto",
    "aria-grabbed",
    "aria-haspopup",
    "aria-hidden",
    "aria-invalid",
    "aria-keyshortcuts",
    "aria-label",
    "aria-labelledby",
    "aria-live",
    "aria-owns",
    "aria-relevant",
    "aria-roledescription",
];

#[derive(Debug, Default, Clone)]
pub struct RoleSupportsAriaProps;

declare_oxc_lint!(
    /// Disallow ARIA properties unsupported by an element's effective role.
    RoleSupportsAriaProps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ARIA properties unsupported by an element's effective role.",
);

impl Rule for RoleSupportsAriaProps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let should_use_curated_behavior = should_use_curated_port_behavior(ctx);
        if should_use_curated_behavior && is_local_test_scaffold_jsx(node, ctx) {
            return;
        }
        let mut aria_attributes = Vec::new();
        for attribute_item in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute_item else {
                continue;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                continue;
            };
            let property_name = identifier.name.to_ascii_lowercase();
            if !property_name.starts_with("aria-")
                || !is_valid_aria_property(&property_name)
                || matches!(
                    attribute.value.as_ref(),
                    Some(JSXAttributeValue::ExpressionContainer(container))
                        if container
                            .expression
                            .as_expression()
                            .is_some_and(is_nullish_expression)
                )
            {
                continue;
            }
            aria_attributes.push((attribute, property_name));
        }
        if aria_attributes.is_empty() {
            return;
        }

        let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
        let role_attribute = has_jsx_prop_ignore_case(opening_element, "role").and_then(
            |attribute| match attribute {
                JSXAttributeItem::Attribute(attribute) => Some(attribute),
                JSXAttributeItem::SpreadAttribute(_) => None,
            },
        );
        let role_candidates = if let Some(role_attribute) = role_attribute {
            let Some(role_candidates) = get_static_jsx_attribute_string_values(role_attribute, ctx)
            else {
                return;
            };
            role_candidates
        } else {
            let Some(implicit_role) = get_implicit_role(opening_element, &element_type, ctx) else {
                return;
            };
            vec![implicit_role.to_string()]
        };
        if role_candidates.is_empty()
            || role_candidates
                .iter()
                .any(|role| !VALID_ARIA_ROLES.contains(role.as_str()))
        {
            return;
        }
        let is_implicit = role_attribute.is_none();

        for (attribute, property_name) in aria_attributes {
            if !should_use_curated_behavior
                && role_candidates
                    .iter()
                    .any(|role| is_upstream_unsupported_property(role, &property_name))
            {
                report_unsupported_property(
                    attribute.span,
                    &property_name,
                    &role_candidates,
                    &element_type,
                    is_implicit,
                    ctx,
                );
                continue;
            }
            if role_candidates
                .iter()
                .any(|role| role_supports_aria_property(role, &property_name))
            {
                continue;
            }
            report_unsupported_property(
                attribute.span,
                &property_name,
                &role_candidates,
                &element_type,
                is_implicit,
                ctx,
            );
        }
    }
}

fn report_unsupported_property(
    span: oxc_span::Span,
    property_name: &str,
    roles: &[String],
    element_type: &str,
    is_implicit: bool,
    ctx: &LintContext,
) {
    let message = if is_implicit {
        format!(
            "Screen reader users get no help from `{property_name}` because `{element_type}` has role `{}`, which ignores it, so remove `{property_name}` or change the element.",
            roles[0]
        )
    } else {
        let role_list = roles
            .iter()
            .map(|role| format!("`{role}`"))
            .collect::<Vec<_>>()
            .join(" / ");
        format!(
            "Screen reader users get no help from `{property_name}` because role {role_list} ignores it, so remove it or change the role."
        )
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}

fn is_upstream_unsupported_property(role: &str, property: &str) -> bool {
    match role {
        "button" | "link" | "menuitem" => property == "aria-invalid",
        "checkbox" => property == "aria-haspopup",
        "radio" | "toolbar" => matches!(property, "aria-haspopup" | "aria-invalid"),
        _ => false,
    }
}

fn role_supports_aria_property(role: &str, property: &str) -> bool {
    if is_prohibited_aria_property(role, property) {
        return false;
    }
    if GLOBAL_ARIA_PROPERTIES.contains(&property) {
        return true;
    }
    let supported_properties = match role {
        "alert" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "alertdialog" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "application" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "article" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize"
        }
        "banner" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "blockquote" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "button" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-pressed aria-relevant aria-roledescription"
        }
        "caption" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "cell" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "checkbox" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "code" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "columnheader" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription aria-rowindex aria-rowspan aria-selected aria-sort"
        }
        "combobox" => {
            "aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "command" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "complementary" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "composite" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "contentinfo" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "definition" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "deletion" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "dialog" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        "directory" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-abstract" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-acknowledgments" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-afterword" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-appendix" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-backlink" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-biblioentry" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize"
        }
        "doc-bibliography" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-biblioref" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-chapter" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-colophon" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-conclusion" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-cover" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-credit" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-credits" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-dedication" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-endnote" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize"
        }
        "doc-endnotes" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-epigraph" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-epilogue" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-errata" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-example" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-footnote" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-foreword" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-glossary" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-glossref" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-index" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-introduction" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-noteref" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-notice" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-pagebreak" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "doc-pagelist" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-part" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-preface" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-prologue" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-pullquote" => "",
        "doc-qna" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-subtitle" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-tip" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "doc-toc" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "document" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "emphasis" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "feed" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "figure" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "form" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "generic" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan"
        }
        "graphics-document" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "graphics-object" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "graphics-symbol" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "grid" => {
            "aria-activedescendant aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiselectable aria-owns aria-readonly aria-relevant aria-roledescription aria-rowcount"
        }
        "gridcell" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription aria-rowindex aria-rowspan aria-selected"
        }
        "group" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "heading" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-relevant aria-roledescription"
        }
        "img" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "input" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "insertion" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "landmark" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "link" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "list" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "listbox" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiselectable aria-orientation aria-owns aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "listitem" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-posinset aria-owns aria-relevant aria-roledescription aria-setsize"
        }
        "log" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "main" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "mark" => {
            "aria-atomic aria-braillelabel aria-brailleroledescription aria-busy aria-controls aria-current aria-describedby aria-description aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "marquee" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "math" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "menu" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "menubar" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "menuitem" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize"
        }
        "menuitemcheckbox" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-readonly aria-relevant aria-required aria-roledescription aria-setsize"
        }
        "menuitemradio" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-readonly aria-relevant aria-required aria-roledescription aria-setsize"
        }
        "meter" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "navigation" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "none" => "",
        "note" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "option" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize"
        }
        "paragraph" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "presentation" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "progressbar" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "radio" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize"
        }
        "radiogroup" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "range" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow"
        }
        "region" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "roletype" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "row" => {
            "aria-activedescendant aria-atomic aria-busy aria-colindex aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-rowindex aria-selected aria-setsize"
        }
        "rowgroup" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "rowheader" => {
            "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription aria-rowindex aria-rowspan aria-selected aria-sort"
        }
        "scrollbar" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "search" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "searchbox" => {
            "aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiline aria-owns aria-placeholder aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "section" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "sectionhead" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "select" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "separator" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "slider" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-readonly aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "spinbutton" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"
        }
        "status" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "strong" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "structure" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "subscript" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "superscript" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "switch" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "tab" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize"
        }
        "table" => {
            "aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowcount"
        }
        "tablist" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-multiselectable aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "tabpanel" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "term" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "textbox" => {
            "aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiline aria-owns aria-placeholder aria-readonly aria-relevant aria-required aria-roledescription"
        }
        "time" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "timer" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "toolbar" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription"
        }
        "tooltip" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "tree" => {
            "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiselectable aria-orientation aria-owns aria-relevant aria-required aria-roledescription"
        }
        "treegrid" => {
            "aria-activedescendant aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiselectable aria-orientation aria-owns aria-readonly aria-relevant aria-required aria-roledescription aria-rowcount"
        }
        "treeitem" => {
            "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize"
        }
        "widget" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"
        }
        "window" => {
            "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription"
        }
        _ => "",
    };
    supported_properties
        .split_ascii_whitespace()
        .any(|supported_property| supported_property == property)
}

fn is_prohibited_aria_property(role: &str, property: &str) -> bool {
    let is_accessible_name_property = matches!(
        property,
        "aria-braillelabel" | "aria-label" | "aria-labelledby"
    );
    match role {
        "caption" | "code" | "definition" | "deletion" | "emphasis" | "insertion" | "mark"
        | "none" | "paragraph" | "presentation" | "strong" | "subscript" | "superscript"
        | "term" | "time" | "tooltip" => is_accessible_name_property,
        "generic" => matches!(
            property,
            "aria-braillelabel"
                | "aria-brailleroledescription"
                | "aria-label"
                | "aria-labelledby"
                | "aria-roledescription"
        ),
        _ => false,
    }
}
