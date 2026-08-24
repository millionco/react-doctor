use std::cell::Cell;

use oxc_ast::{ast::JSXAttributeItem, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case, AstNode};

const MESSAGE: &str = "This icon-only Button has no accessible name, so screen readers announce an unnamed button. Add aria-label or an sr-only text child (e.g. <span className=\"sr-only\">Delete</span>).";
const ICON_SIZE_PREFIX: &str = "icon";
const NAME_PROVIDING_ATTRIBUTES: [&str; 3] = ["aria-label", "aria-labelledby", "title"];
const ICON_LIBRARY_PACKAGES: [&str; 13] = [
    "lucide-react",
    "lucide-react-native",
    "react-feather",
    "phosphor-react",
    "iconoir-react",
    "react-bootstrap-icons",
    "@heroicons/react",
    "@tabler/icons-react",
    "@phosphor-icons/react",
    "@radix-ui/react-icons",
    "@mui/icons-material",
    "@ant-design/icons",
    "@primer/octicons-react",
];

#[derive(Debug, Default, Clone)]
pub struct ShadcnIconButtonRequiresLabel;

declare_oxc_lint!(
    /// Require accessible names on icon-only shadcn buttons.
    ShadcnIconButtonRequiresLabel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible names on icon-only shadcn buttons.",
);

impl Rule for ShadcnIconButtonRequiresLabel {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_shadcn_component_name(&opening_element.name, "button", ctx).as_deref()
            != Some("Button")
            || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        if let Some(as_child_attribute) = find_jsx_attribute(opening_element, "asChild")
            && !jsx_attribute_is_static_false(as_child_attribute)
        {
            return;
        }
        if let Some(slot_attribute) = find_jsx_attribute(opening_element, "slot") {
            let Some(slot_value) = get_string_literal_attribute_value(slot_attribute) else {
                return;
            };
            if slot_value == "remove" {
                return;
            }
        }
        if NAME_PROVIDING_ATTRIBUTES.iter().any(|attribute_name| {
            let attribute = has_jsx_prop_ignore_case(opening_element, attribute_name).and_then(
                |attribute| {
                    let JSXAttributeItem::Attribute(attribute) = attribute else {
                        return None;
                    };
                    Some(attribute.as_ref())
                },
            );
            jsx_attribute_may_have_non_empty_value(attribute, false, Some(ctx))
        }) {
            return;
        }
        let Some(size_attribute) = find_jsx_attribute(opening_element, "size") else {
            return;
        };
        let Some(size_values) = get_static_jsx_attribute_string_values(size_attribute, ctx) else {
            return;
        };
        if size_values.is_empty()
            || size_values
                .iter()
                .any(|size_value| !size_value.starts_with(ICON_SIZE_PREFIX))
            || is_inside_jsx_attribute(node, ctx)
        {
            return;
        }
        let parent = ctx.nodes().parent_node(node.id());
        let AstKind::JSXElement(button_element) = parent.kind() else {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
            return;
        };
        let has_accessible_text = Cell::new(false);
        let has_unprovable_content = Cell::new(false);
        visit_static_jsx_children(
            &button_element.children,
            &mut |element| {
                let child_opening_element = &element.opening_element;
                if is_statically_hidden_from_screen_reader(child_opening_element, ctx) {
                    return false;
                }
                if NAME_PROVIDING_ATTRIBUTES.iter().any(|attribute_name| {
                    let attribute = has_jsx_prop_ignore_case(
                        child_opening_element,
                        attribute_name,
                    )
                    .and_then(|attribute| {
                        let JSXAttributeItem::Attribute(attribute) = attribute else {
                            return None;
                        };
                        Some(attribute.as_ref())
                    });
                    jsx_attribute_may_have_non_empty_value(attribute, false, Some(ctx))
                }) {
                    has_accessible_text.set(true);
                    return false;
                }
                if is_icon_element_name(&child_opening_element.name, ctx) {
                    return false;
                }
                let trailing_segment =
                    jsx_element_name_trailing_segment(&child_opening_element.name);
                if trailing_segment == Some("img") {
                    let alt_attribute = has_jsx_prop_ignore_case(child_opening_element, "alt")
                        .and_then(|attribute| {
                            let JSXAttributeItem::Attribute(attribute) = attribute else {
                                return None;
                            };
                            Some(attribute.as_ref())
                        });
                    if jsx_attribute_may_have_non_empty_value(alt_attribute, false, Some(ctx)) {
                        has_accessible_text.set(true);
                    }
                    return false;
                }
                if trailing_segment.is_some_and(|name| {
                    name != "Fragment"
                        && name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                }) {
                    has_unprovable_content.set(true);
                }
                true
            },
            &mut || has_unprovable_content.set(true),
            &mut || has_accessible_text.set(true),
        );
        if has_accessible_text.get() || has_unprovable_content.get() {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn jsx_attribute_is_static_false(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
        attribute.value.as_ref()
    else {
        return false;
    };
    matches!(
        container
            .expression
            .as_expression()
            .map(oxc_ast::ast::Expression::get_inner_expression),
        Some(oxc_ast::ast::Expression::BooleanLiteral(boolean_literal))
            if !boolean_literal.value
    )
}

fn is_inside_jsx_attribute(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| matches!(ancestor.kind(), AstKind::JSXAttribute(_)))
}

fn is_icon_element_name<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(trailing_segment) = jsx_element_name_trailing_segment(element_name) else {
        return false;
    };
    trailing_segment != "svg"
        && (is_icon_component_name(trailing_segment) || is_icon_library_import(element_name, ctx))
}

fn is_icon_component_name(component_name: &str) -> bool {
    component_name.ends_with("Icon")
        || component_name.strip_prefix("Icon").is_some_and(|suffix| {
            suffix.is_empty()
                || suffix
                    .as_bytes()
                    .first()
                    .is_some_and(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
        || component_name.starts_with("Spinner")
        || component_name.starts_with("Loader")
}

fn is_icon_library_import<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root_identifier = match element_name {
        oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => identifier,
        oxc_ast::ast::JSXElementName::MemberExpression(member_expression) => {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            identifier
        }
        _ => return false,
    };
    resolve_identifier_import(root_identifier, ctx)
        .is_some_and(|entry| is_icon_library_module(entry.module_request.name()))
}

fn is_icon_library_module(module_source: &str) -> bool {
    module_source == "react-icons"
        || module_source.starts_with("react-icons/")
        || module_source == "@fortawesome/react-fontawesome"
        || module_source
            .strip_prefix("@fortawesome/free-")
            .is_some_and(|tail| {
                tail.split('/').next().is_some_and(|package_name| {
                    package_name.ends_with("-svg-icons")
                })
            })
        || ICON_LIBRARY_PACKAGES.iter().any(|package_name| {
            module_source == *package_name
                || module_source
                    .strip_prefix(package_name)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
}
