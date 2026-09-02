use oxc_ast::{AstKind, ast::JSXAttribute};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{AstNode, rule::Rule};

const MESSAGE: &str = "Placeholder text disappears during entry and cannot replace a persistent field label. Add a visible associated label.";
const WINDMILL_REACT_UI_PACKAGE: &str = "@windmill/react-ui";
const NON_TEXT_INPUT_TYPES: [&str; 15] = [
    "button",
    "checkbox",
    "color",
    "date",
    "datetime-local",
    "file",
    "hidden",
    "image",
    "month",
    "radio",
    "range",
    "reset",
    "submit",
    "time",
    "week",
];
const LABELABLE_ELEMENT_NAMES: [&str; 7] = [
    "button", "input", "meter", "output", "progress", "select", "textarea",
];

#[derive(Debug)]
enum PlaceholderAssociationValue {
    Empty,
    Static(String),
    Dynamic,
}

#[derive(Debug)]
struct PlaceholderFieldCandidate {
    id: Option<String>,
    node_id: NodeId,
    owner_id: Option<NodeId>,
}

type PlaceholderLabelIndex = FxHashMap<Option<NodeId>, FxHashMap<String, Vec<NodeId>>>;

#[derive(Debug, Default, Clone)]
pub struct NoPlaceholderOnlyField;

declare_oxc_lint!(
    /// Disallow text fields that rely on placeholder text for their accessible label.
    NoPlaceholderOnlyField,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow text fields that rely only on placeholder text for a label.",
);

impl Rule for NoPlaceholderOnlyField {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut labels_by_owner_and_control_id = PlaceholderLabelIndex::default();
        let mut field_candidates = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let element_name = placeholder_opening_element_name(&opening_element.name);
            let html_for_attribute =
                get_authoritative_jsx_attribute(opening_element, "htmlFor", false)
                    .or_else(|| get_authoritative_jsx_attribute(opening_element, "for", false));
            let html_for_value = html_for_attribute
                .map(|attribute| placeholder_static_association_value(attribute, ctx));

            if placeholder_is_custom_element(&opening_element.name) {
                if let Some(PlaceholderAssociationValue::Static(control_id)) = html_for_value
                    && !control_id.is_empty()
                    && !placeholder_is_inside_hidden_subtree(node, ctx)
                {
                    placeholder_record_label_association(
                        node,
                        control_id,
                        &mut labels_by_owner_and_control_id,
                        ctx,
                    );
                }
                continue;
            }

            if element_name == Some("label") {
                if let Some(PlaceholderAssociationValue::Static(control_id)) = html_for_value
                    && !control_id.is_empty()
                    && !placeholder_is_inside_hidden_subtree(node, ctx)
                    && placeholder_parent_jsx_element(node, ctx)
                        .is_some_and(|element| object_has_accessible_child(element, ctx))
                {
                    placeholder_record_label_association(
                        node,
                        control_id,
                        &mut labels_by_owner_and_control_id,
                        ctx,
                    );
                }
                continue;
            }

            if !matches!(element_name, Some("input" | "textarea"))
                || placeholder_is_inside_hidden_subtree(node, ctx)
                || placeholder_has_possible_enclosing_label(node, opening_element, ctx)
            {
                continue;
            }
            if ["aria-label", "aria-labelledby"]
                .iter()
                .any(|attribute_name| {
                    let attribute =
                        get_authoritative_jsx_attribute(opening_element, attribute_name, false);
                    attribute.is_some_and(|attribute| {
                        jsx_attribute_may_have_non_empty_value(Some(attribute), true, Some(ctx))
                    }) || attribute.is_none()
                        && has_spread_that_may_provide_attribute(opening_element, attribute_name)
                })
            {
                continue;
            }
            if element_name == Some("input")
                && placeholder_input_type_is_exempt_or_unknown(opening_element)
            {
                continue;
            }
            let Some(placeholder_attribute) =
                get_authoritative_jsx_attribute(opening_element, "placeholder", false)
            else {
                continue;
            };
            if get_string_literal_attribute_value(placeholder_attribute)
                .is_none_or(|placeholder| placeholder.trim().is_empty())
            {
                continue;
            }
            let id_attribute = get_authoritative_jsx_attribute(opening_element, "id", false);
            if id_attribute.is_none()
                && has_spread_that_may_provide_attribute(opening_element, "id")
            {
                continue;
            }
            let id = match id_attribute
                .map(|attribute| placeholder_static_association_value(attribute, ctx))
            {
                Some(PlaceholderAssociationValue::Dynamic) => continue,
                Some(PlaceholderAssociationValue::Static(id)) if !id.is_empty() => Some(id),
                _ => None,
            };
            field_candidates.push(PlaceholderFieldCandidate {
                id,
                node_id: node.id(),
                owner_id: placeholder_nearest_function_id(node, ctx),
            });
        }

        for candidate in field_candidates {
            let has_matching_label = candidate.id.as_ref().is_some_and(|control_id| {
                labels_by_owner_and_control_id
                    .get(&candidate.owner_id)
                    .and_then(|labels_by_control_id| labels_by_control_id.get(control_id))
                    .is_some_and(|label_node_ids| {
                        let field_node = ctx.nodes().get_node(candidate.node_id);
                        label_node_ids.iter().any(|label_node_id| {
                            nodes_can_co_execute(
                                ctx.nodes().get_node(*label_node_id),
                                field_node,
                                ctx,
                            )
                        })
                    })
            });
            if !has_matching_label {
                let AstKind::JSXOpeningElement(opening_element) =
                    ctx.nodes().get_node(candidate.node_id).kind()
                else {
                    continue;
                };
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
            }
        }
    }
}

fn placeholder_record_label_association(
    node: &AstNode<'_>,
    control_id: String,
    labels_by_owner_and_control_id: &mut PlaceholderLabelIndex,
    ctx: &LintContext<'_>,
) {
    labels_by_owner_and_control_id
        .entry(placeholder_nearest_function_id(node, ctx))
        .or_default()
        .entry(control_id)
        .or_default()
        .push(node.id());
}

fn placeholder_opening_element_name<'a>(element_name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match element_name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn placeholder_is_custom_element(element_name: &JSXElementName<'_>) -> bool {
    matches!(element_name, JSXElementName::MemberExpression(_))
        || placeholder_opening_element_name(element_name)
            .is_some_and(|name| name.as_bytes().first().is_some_and(u8::is_ascii_uppercase))
}

fn placeholder_static_association_value(
    attribute: &JSXAttribute<'_>,
    ctx: &LintContext<'_>,
) -> PlaceholderAssociationValue {
    if attribute.value.is_none() {
        return PlaceholderAssociationValue::Empty;
    }
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return PlaceholderAssociationValue::Static(value.to_string());
    }
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
        attribute.value.as_ref()
    else {
        return PlaceholderAssociationValue::Dynamic;
    };
    let Some(expression) = container.expression.as_expression() else {
        return PlaceholderAssociationValue::Empty;
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => {
            PlaceholderAssociationValue::Empty
        }
        Expression::NumericLiteral(literal) => {
            PlaceholderAssociationValue::Static(literal.value.to_string())
        }
        Expression::BigIntLiteral(literal) => PlaceholderAssociationValue::Static(
            literal
                .raw
                .as_ref()
                .map_or("", |raw| raw.as_str())
                .trim_end_matches('n')
                .to_string(),
        ),
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => {
            PlaceholderAssociationValue::Empty
        }
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            PlaceholderAssociationValue::Empty
        }
        _ => PlaceholderAssociationValue::Dynamic,
    }
}

fn placeholder_input_type_is_exempt_or_unknown(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let type_attribute = get_authoritative_jsx_attribute(opening_element, "type", false);
    if type_attribute.is_none() && has_spread_that_may_provide_attribute(opening_element, "type") {
        return true;
    }
    let Some(type_attribute) = type_attribute else {
        return false;
    };
    let Some(input_type) = get_string_literal_attribute_value(type_attribute) else {
        return true;
    };
    NON_TEXT_INPUT_TYPES
        .iter()
        .any(|non_text_type| input_type.eq_ignore_ascii_case(non_text_type))
}

fn placeholder_is_inside_hidden_subtree(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::JSXElement(element) if is_hidden_from_screen_reader(&element.opening_element, ctx))
    })
}

fn placeholder_has_possible_enclosing_label<'a>(
    node: &AstNode<'a>,
    field: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if placeholder_opening_element_name(&element.opening_element.name) == Some("label") {
            return !is_hidden_from_screen_reader(&element.opening_element, ctx)
                && placeholder_label_may_own_nested_field(element, field, ctx)
                && object_has_accessible_child(element, ctx);
        }
        if resolve_imported_jsx_component_name(
            &element.opening_element,
            WINDMILL_REACT_UI_PACKAGE,
            ctx,
        ) == Some("Label")
            && !is_hidden_from_screen_reader(&element.opening_element, ctx)
            && object_has_accessible_child(element, ctx)
        {
            return true;
        }
    }
    false
}

fn placeholder_label_may_own_nested_field<'a>(
    label: &'a oxc_ast::ast::JSXElement<'a>,
    field: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let html_for_attribute =
        get_authoritative_jsx_attribute(&label.opening_element, "htmlFor", false)
            .or_else(|| get_authoritative_jsx_attribute(&label.opening_element, "for", false));
    let Some(html_for_attribute) = html_for_attribute else {
        return placeholder_first_static_labelable_descendant(&label.children)
            .is_none_or(|descendant| descendant.span == field.span);
    };
    let html_for_value = placeholder_static_association_value(html_for_attribute, ctx);
    let PlaceholderAssociationValue::Static(html_for_value) = html_for_value else {
        return matches!(html_for_value, PlaceholderAssociationValue::Dynamic);
    };
    if html_for_value.is_empty() {
        return false;
    }
    let Some(id_attribute) = get_authoritative_jsx_attribute(field, "id", false) else {
        return false;
    };
    match placeholder_static_association_value(id_attribute, ctx) {
        PlaceholderAssociationValue::Dynamic => true,
        PlaceholderAssociationValue::Static(field_id) => field_id == html_for_value,
        PlaceholderAssociationValue::Empty => false,
    }
}

fn placeholder_first_static_labelable_descendant<'a>(
    children: &'a [JSXChild<'a>],
) -> Option<&'a oxc_ast::ast::JSXOpeningElement<'a>> {
    for child in children {
        let descendant = match child {
            JSXChild::Element(element) => {
                let opening_element = &element.opening_element;
                if placeholder_opening_element_name(&opening_element.name).is_some_and(|name| {
                    LABELABLE_ELEMENT_NAMES.contains(&name)
                        && !placeholder_input_is_hidden(opening_element)
                }) {
                    Some(opening_element.as_ref())
                } else {
                    placeholder_first_static_labelable_descendant(&element.children)
                }
            }
            JSXChild::Fragment(fragment) => {
                placeholder_first_static_labelable_descendant(&fragment.children)
            }
            _ => None,
        };
        if descendant.is_some() {
            return descendant;
        }
    }
    None
}

fn placeholder_input_is_hidden(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    placeholder_opening_element_name(&opening_element.name) == Some("input")
        && get_authoritative_jsx_attribute(opening_element, "type", false)
            .and_then(get_string_literal_attribute_value)
            .is_some_and(|input_type| input_type.eq_ignore_ascii_case("hidden"))
}

fn placeholder_parent_jsx_element<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::JSXElement<'a>> {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return None;
    };
    Some(element)
}

fn placeholder_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}
