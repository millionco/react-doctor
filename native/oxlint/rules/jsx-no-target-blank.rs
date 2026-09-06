use rustc_hash::{FxHashMap, FxHashSet};

use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXElementName, ObjectPropertyKind, PropertyKey, PropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NOREFERRER_MESSAGE: &str = "`target=\"_blank\"` without `rel=\"noreferrer\"` lets the linked page hijack your tab to a phishing site.";
const NOOPENER_MESSAGE: &str = "`target=\"_blank\"` without `noopener` or `noreferrer` in `rel` lets the linked page hijack your tab to a phishing site.";
const SPREAD_MESSAGE: &str = "A spread here can add `target=\"_blank\"`, letting the linked page hijack your tab to a phishing site.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoTargetBlank;

declare_oxc_lint!(
    /// Require explicit protection for links and forms that open a new browsing context.
    JsxNoTargetBlank,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require safe rel values with target=_blank.",
);

#[derive(Clone, Copy, Eq, PartialEq)]
enum DynamicLinkPolicy {
    Always,
    Never,
}

struct Settings {
    enforce_dynamic_links: DynamicLinkPolicy,
    warn_on_spread_attributes: bool,
    allow_referrer: bool,
    links: bool,
    forms: bool,
    link_components: FxHashMap<String, Vec<String>>,
    form_components: FxHashMap<String, Vec<String>>,
}

#[derive(Default)]
struct BranchTuple {
    combined: bool,
    is_complete: bool,
    test_key: String,
    consequent: bool,
    alternate: bool,
}

struct ConditionalPredicate {
    is_negated: bool,
    key: String,
}

struct DestinationState {
    has_value: bool,
    is_authoritative: bool,
    is_valid: bool,
}

struct ElementState {
    destinations: FxHashMap<String, DestinationState>,
    target_tuple: BranchTuple,
    rel_tuple: BranchTuple,
    warn_spread: bool,
    target_report_span: Span,
    spread_report_span: Option<Span>,
    is_target_authoritative: bool,
    is_rel_authoritative: bool,
}

#[derive(Clone, Copy)]
enum PropertyValue<'a> {
    String(&'a str),
    Expression(&'a Expression<'a>),
    Missing,
    EmptyExpression,
    Unknown,
}

impl Rule for JsxNoTargetBlank {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = resolve_settings(ctx);
        if !settings.links && !settings.forms {
            return;
        }
        let should_use_curated_behavior = should_use_curated_port_behavior(ctx);
        let has_jsx_spread = ctx
            .nodes()
            .iter()
            .any(|node| matches!(node.kind(), AstKind::JSXSpreadAttribute(_)));
        let property_write_analysis =
            has_jsx_spread.then(|| build_possible_static_property_write_analysis(ctx));

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                &opening_element.name,
                JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
            ) {
                continue;
            }
            let Some((tag_name, tag_span)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            let tag_is_link = settings.links
                && (tag_name == "a" || settings.link_components.contains_key(tag_name));
            let tag_is_form = settings.forms
                && (tag_name == "form" || settings.form_components.contains_key(tag_name));
            if !tag_is_link && !tag_is_form {
                continue;
            }

            inspect_opening_element(
                opening_element,
                tag_name,
                tag_span,
                tag_is_link,
                tag_is_form,
                &settings,
                should_use_curated_behavior,
                property_write_analysis.as_ref(),
                ctx,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn inspect_opening_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    tag_name: &str,
    tag_span: Span,
    tag_is_link: bool,
    tag_is_form: bool,
    settings: &Settings,
    should_use_curated_behavior: bool,
    property_write_analysis: Option<&PossibleStaticPropertyWriteAnalysis>,
    ctx: &LintContext<'a>,
) {
    let link_attribute_names = if tag_name == "a" {
        vec!["href".to_string()]
    } else {
        settings
            .link_components
            .get(tag_name)
            .cloned()
            .unwrap_or_default()
    };
    let form_attribute_names = if tag_name == "form" {
        vec!["action".to_string()]
    } else {
        settings
            .form_components
            .get(tag_name)
            .cloned()
            .unwrap_or_default()
    };
    let mut destination_attribute_names = FxHashSet::default();
    if tag_is_link {
        destination_attribute_names.extend(link_attribute_names);
    }
    if tag_is_form {
        destination_attribute_names.extend(form_attribute_names);
    }
    let mut observed_property_names = destination_attribute_names.clone();
    observed_property_names.insert("target".to_string());
    observed_property_names.insert("rel".to_string());
    let mut state = ElementState {
        destinations: destination_attribute_names
            .iter()
            .map(|name| {
                (
                    name.clone(),
                    DestinationState {
                        has_value: false,
                        is_authoritative: true,
                        is_valid: true,
                    },
                )
            })
            .collect(),
        target_tuple: BranchTuple::default(),
        rel_tuple: BranchTuple::default(),
        warn_spread: false,
        target_report_span: tag_span,
        spread_report_span: None,
        is_target_authoritative: true,
        is_rel_authoritative: true,
    };

    for attribute in &opening_element.attributes {
        match attribute {
            JSXAttributeItem::SpreadAttribute(spread) => {
                visit_static_spread_properties(
                    &spread.argument,
                    &observed_property_names,
                    spread.span,
                    settings,
                    should_use_curated_behavior,
                    &mut state,
                    &mut FxHashSet::default(),
                    property_write_analysis,
                    ctx,
                );
            }
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    continue;
                };
                let value = property_value_from_jsx_attribute(attribute.value.as_ref());
                let report_span = attribute
                    .value
                    .as_ref()
                    .map_or(attribute.span, GetSpan::span);
                apply_property(
                    attribute_name.name.as_str(),
                    value,
                    report_span,
                    settings,
                    should_use_curated_behavior,
                    &mut state,
                    ctx,
                );
            }
        }
    }

    if state.warn_spread {
        let all_destinations_proven_safe = state
            .destinations
            .values()
            .all(|destination| destination.is_authoritative && destination.is_valid);
        if all_destinations_proven_safe || state.rel_tuple.combined {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(SPREAD_MESSAGE)
                .with_label(state.spread_report_span.unwrap_or(opening_element.span)),
        );
        return;
    }

    let has_unsafe_authoritative_destination = state.destinations.values().any(|destination| {
        destination.has_value && destination.is_authoritative && !destination.is_valid
    });
    if !has_unsafe_authoritative_destination
        || !state.is_target_authoritative
        || !state.is_rel_authoritative
    {
        return;
    }
    let message = if settings.allow_referrer {
        NOOPENER_MESSAGE
    } else {
        NOREFERRER_MESSAGE
    };
    if !state.target_tuple.test_key.is_empty()
        && state.target_tuple.test_key == state.rel_tuple.test_key
    {
        let consequent_bad = state.target_tuple.consequent && !state.rel_tuple.consequent;
        let alternate_bad = state.target_tuple.alternate && !state.rel_tuple.alternate;
        if consequent_bad || alternate_bad {
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(state.target_report_span));
        }
        return;
    }
    if state.target_tuple.combined && !state.rel_tuple.combined {
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(state.target_report_span));
    }
}

fn resolve_settings(ctx: &LintContext<'_>) -> Settings {
    let root_settings = ctx.settings().json.as_ref();
    let react_doctor_settings = root_settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object);
    let rule_settings = react_doctor_settings
        .and_then(|settings| settings.get("jsxNoTargetBlank"))
        .and_then(serde_json::Value::as_object);
    let react_settings = root_settings
        .and_then(|settings| settings.get("react"))
        .and_then(serde_json::Value::as_object);
    let explicit_allow_referrer = rule_settings
        .and_then(|settings| settings.get("allowReferrer"))
        .filter(|value| !value.is_null());
    Settings {
        enforce_dynamic_links: if rule_settings
            .and_then(|settings| settings.get("enforceDynamicLinks"))
            .and_then(serde_json::Value::as_str)
            == Some("never")
        {
            DynamicLinkPolicy::Never
        } else {
            DynamicLinkPolicy::Always
        },
        warn_on_spread_attributes: nullable_javascript_truthiness(
            rule_settings.and_then(|settings| settings.get("warnOnSpreadAttributes")),
            false,
        ),
        allow_referrer: explicit_allow_referrer.map_or_else(
            || {
                has_capability(ctx, "target-blank-needs-explicit-protection")
                    && !has_capability(ctx, "target-blank-needs-noreferrer")
            },
            javascript_truthiness,
        ),
        links: nullable_javascript_truthiness(
            rule_settings.and_then(|settings| settings.get("links")),
            true,
        ),
        forms: nullable_javascript_truthiness(
            rule_settings.and_then(|settings| settings.get("forms")),
            false,
        ),
        link_components: configured_components(
            react_settings,
            "linkComponents",
            "linkAttribute",
            "href",
        ),
        form_components: configured_components(
            react_settings,
            "formComponents",
            "formAttribute",
            "action",
        ),
    }
}

fn nullable_javascript_truthiness(value: Option<&serde_json::Value>, fallback: bool) -> bool {
    value
        .filter(|value| !value.is_null())
        .map_or(fallback, javascript_truthiness)
}

fn javascript_truthiness(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
}

fn configured_components(
    react_settings: Option<&serde_json::Map<String, serde_json::Value>>,
    setting_name: &str,
    attribute_setting_name: &str,
    default_attribute_name: &str,
) -> FxHashMap<String, Vec<String>> {
    let mut components = FxHashMap::default();
    let Some(entries) = react_settings
        .and_then(|settings| settings.get(setting_name))
        .and_then(serde_json::Value::as_array)
    else {
        return components;
    };
    for entry in entries {
        if let Some(name) = entry.as_str() {
            components.insert(name.to_string(), vec![default_attribute_name.to_string()]);
            continue;
        }
        let Some(object) = entry.as_object() else {
            continue;
        };
        let Some(name) = object.get("name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let attribute_setting = object.get(attribute_setting_name);
        let attribute_names = match attribute_setting {
            None | Some(serde_json::Value::Null) => vec![default_attribute_name.to_string()],
            Some(serde_json::Value::String(name)) => vec![name.clone()],
            Some(serde_json::Value::Array(names)) => names
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToString::to_string)
                .collect(),
            _ => Vec::new(),
        };
        components.insert(name.to_string(), attribute_names);
    }
    components
}

fn property_value_from_jsx_attribute<'a>(
    value: Option<&'a JSXAttributeValue<'a>>,
) -> PropertyValue<'a> {
    match value {
        None => PropertyValue::Missing,
        Some(JSXAttributeValue::StringLiteral(literal)) => {
            PropertyValue::String(literal.value.as_str())
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .map_or(PropertyValue::EmptyExpression, PropertyValue::Expression),
        _ => PropertyValue::Unknown,
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_property<'a>(
    property_name: &str,
    property_value: PropertyValue<'a>,
    report_span: Span,
    settings: &Settings,
    should_use_curated_behavior: bool,
    state: &mut ElementState,
    ctx: &LintContext<'a>,
) {
    if property_name == "target" {
        state.is_target_authoritative = true;
        state.target_tuple = match property_value {
            PropertyValue::Missing => BranchTuple {
                is_complete: true,
                ..BranchTuple::default()
            },
            _ => check_target(property_value, ctx),
        };
        state.target_report_span = report_span;
        if should_use_curated_behavior
            && state.target_tuple.is_complete
            && !state.target_tuple.combined
        {
            state.warn_spread = false;
            state.spread_report_span = None;
        }
        return;
    }
    if let Some(destination) = state.destinations.get_mut(property_name) {
        destination.has_value = true;
        destination.is_authoritative = true;
        destination.is_valid = match property_value {
            PropertyValue::Missing => true,
            _ => check_href(property_value, settings.enforce_dynamic_links, ctx),
        };
        return;
    }
    if property_name == "rel" {
        state.is_rel_authoritative = true;
        state.rel_tuple = match property_value {
            PropertyValue::Missing => BranchTuple {
                is_complete: true,
                ..BranchTuple::default()
            },
            _ => check_rel(property_value, settings.allow_referrer, ctx),
        };
    }
}

fn apply_unknown_spread(
    spread_span: Span,
    warn_on_spread_attributes: bool,
    state: &mut ElementState,
) {
    state.is_target_authoritative = false;
    state.is_rel_authoritative = false;
    for destination in state.destinations.values_mut() {
        destination.is_authoritative = false;
    }
    if !warn_on_spread_attributes {
        return;
    }
    state.warn_spread = true;
    state.spread_report_span = Some(spread_span);
    state.target_tuple = BranchTuple::default();
    state.rel_tuple = BranchTuple::default();
}

#[allow(clippy::too_many_arguments)]
fn visit_static_spread_properties<'a>(
    expression: &'a Expression<'a>,
    observed_property_names: &FxHashSet<String>,
    spread_span: Span,
    settings: &Settings,
    should_use_curated_behavior: bool,
    state: &mut ElementState,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    property_write_analysis: Option<&PossibleStaticPropertyWriteAnalysis>,
    ctx: &LintContext<'a>,
) {
    let unwrapped_expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = unwrapped_expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
            return;
        };
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
            return;
        };
        let is_const_binding = matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
        ) && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id);
        let Some(initializer) = declarator.init.as_ref() else {
            apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
            return;
        };
        let identifier_node = ctx.nodes().get_node(
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .node_id(),
        );
        let has_possible_mutation_or_escape = property_write_analysis.is_none_or(|analysis| {
            observed_property_names.iter().any(|property_name| {
                target_blank_has_possible_static_property_mutation_or_escape_before(
                    identifier,
                    property_name,
                    identifier_node,
                    analysis,
                    ctx,
                )
            })
        });
        if !is_const_binding
            || !visited_symbol_ids.insert(symbol_id)
            || has_possible_mutation_or_escape
        {
            apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
            return;
        }
        visit_static_spread_properties(
            initializer,
            observed_property_names,
            spread_span,
            settings,
            should_use_curated_behavior,
            state,
            visited_symbol_ids,
            property_write_analysis,
            ctx,
        );
        visited_symbol_ids.remove(&symbol_id);
        return;
    }
    if unwrapped_expression.is_literal() {
        return;
    }
    let Expression::ObjectExpression(object) = unwrapped_expression else {
        apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
        return;
    };
    for property in &object.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(spread) => visit_static_spread_properties(
                &spread.argument,
                observed_property_names,
                spread_span,
                settings,
                should_use_curated_behavior,
                state,
                visited_symbol_ids,
                property_write_analysis,
                ctx,
            ),
            ObjectPropertyKind::ObjectProperty(property) => {
                if property.kind != PropertyKind::Init || property.method {
                    apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
                    continue;
                }
                let Some(property_name) = static_object_property_name(property) else {
                    apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
                    continue;
                };
                if property_name.is_empty() {
                    apply_unknown_spread(spread_span, settings.warn_on_spread_attributes, state);
                    continue;
                }
                apply_property(
                    property_name.as_str(),
                    PropertyValue::Expression(&property.value),
                    property.span,
                    settings,
                    should_use_curated_behavior,
                    state,
                    ctx,
                );
            }
        }
    }
}

fn static_object_property_name(property: &oxc_ast::ast::ObjectProperty<'_>) -> Option<String> {
    if property.computed {
        return match &property.key {
            PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
            PropertyKey::TemplateLiteral(template)
                if template.expressions.is_empty() && template.quasis.len() == 1 =>
            {
                let quasi = &template.quasis[0];
                Some(
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                        .to_string(),
                )
            }
            _ => None,
        };
    }
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

fn check_href<'a>(
    value: PropertyValue<'a>,
    policy: DynamicLinkPolicy,
    ctx: &LintContext<'a>,
) -> bool {
    let mut is_external = false;
    let mut is_dynamic = false;
    match value {
        PropertyValue::String(value) => is_external = is_external_link(value),
        PropertyValue::Expression(expression) => {
            match_href_expression(expression, &mut is_external, &mut is_dynamic, ctx)
        }
        PropertyValue::Missing | PropertyValue::EmptyExpression | PropertyValue::Unknown => {
            is_dynamic = true;
        }
    }
    match policy {
        DynamicLinkPolicy::Never => !is_external || is_dynamic,
        DynamicLinkPolicy::Always => !(is_external || is_dynamic),
    }
}

fn match_href_expression<'a>(
    expression: &Expression<'a>,
    is_external: &mut bool,
    is_dynamic: &mut bool,
    ctx: &LintContext<'a>,
) {
    let mut visited_symbol_ids = FxHashSet::default();
    let expression = resolve_const_expression(expression, ctx, &mut visited_symbol_ids);
    if let Expression::StringLiteral(literal) = expression {
        *is_external |= is_external_link(literal.value.as_str());
        return;
    }
    if expression.is_literal() {
        return;
    }
    match expression {
        Expression::TemplateLiteral(template) => {
            if template.expressions.is_empty() {
                *is_external |= is_external_link(template_text(template));
            } else {
                *is_dynamic = true;
            }
        }
        Expression::ConditionalExpression(conditional) => {
            match_href_expression(&conditional.consequent, is_external, is_dynamic, ctx);
            match_href_expression(&conditional.alternate, is_external, is_dynamic, ctx);
        }
        _ => *is_dynamic = true,
    }
}

fn check_rel<'a>(
    value: PropertyValue<'a>,
    allow_referrer: bool,
    ctx: &LintContext<'a>,
) -> BranchTuple {
    match value {
        PropertyValue::String(value) => BranchTuple {
            combined: check_rel_value(value, allow_referrer),
            is_complete: true,
            ..BranchTuple::default()
        },
        PropertyValue::Expression(expression) => {
            let mut visited_symbol_ids = FxHashSet::default();
            match_rel_expression(expression, allow_referrer, ctx, &mut visited_symbol_ids)
        }
        PropertyValue::Missing | PropertyValue::EmptyExpression | PropertyValue::Unknown => {
            BranchTuple::default()
        }
    }
}

fn match_rel_expression<'a>(
    expression: &Expression<'a>,
    allow_referrer: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> BranchTuple {
    let expression = resolve_const_expression(expression, ctx, visited_symbol_ids);
    if let Expression::StringLiteral(literal) = expression {
        return BranchTuple {
            combined: check_rel_value(literal.value.as_str(), allow_referrer),
            is_complete: true,
            ..BranchTuple::default()
        };
    }
    match expression {
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => BranchTuple {
            combined: check_rel_value(template_text(template), allow_referrer),
            is_complete: true,
            ..BranchTuple::default()
        },
        Expression::ConditionalExpression(conditional) => {
            let mut consequent_visited = visited_symbol_ids.clone();
            let consequent = match_rel_expression(
                &conditional.consequent,
                allow_referrer,
                ctx,
                &mut consequent_visited,
            );
            let mut alternate_visited = visited_symbol_ids.clone();
            let alternate = match_rel_expression(
                &conditional.alternate,
                allow_referrer,
                ctx,
                &mut alternate_visited,
            );
            let predicate =
                resolve_conditional_predicate(&conditional.test, ctx, &mut FxHashSet::default());
            BranchTuple {
                combined: consequent.combined && alternate.combined,
                is_complete: consequent.is_complete && alternate.is_complete,
                test_key: predicate
                    .as_ref()
                    .map_or_else(String::new, |predicate| predicate.key.clone()),
                consequent: predicate.as_ref().map_or(consequent.combined, |predicate| {
                    if predicate.is_negated {
                        alternate.combined
                    } else {
                        consequent.combined
                    }
                }),
                alternate: predicate.as_ref().map_or(alternate.combined, |predicate| {
                    if predicate.is_negated {
                        consequent.combined
                    } else {
                        alternate.combined
                    }
                }),
            }
        }
        _ => BranchTuple::default(),
    }
}

fn check_target<'a>(value: PropertyValue<'a>, ctx: &LintContext<'a>) -> BranchTuple {
    match value {
        PropertyValue::String(value) => BranchTuple {
            combined: value.eq_ignore_ascii_case("_blank"),
            is_complete: true,
            ..BranchTuple::default()
        },
        PropertyValue::Expression(expression) => {
            let mut visited_symbol_ids = FxHashSet::default();
            match_target_expression(expression, ctx, &mut visited_symbol_ids)
        }
        PropertyValue::EmptyExpression => BranchTuple {
            is_complete: true,
            ..BranchTuple::default()
        },
        PropertyValue::Missing | PropertyValue::Unknown => BranchTuple::default(),
    }
}

fn match_target_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> BranchTuple {
    let expression = resolve_const_expression(expression, ctx, visited_symbol_ids);
    if let Expression::Identifier(identifier) = expression
        && identifier.name == "undefined"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
    {
        return BranchTuple {
            is_complete: true,
            ..BranchTuple::default()
        };
    }
    if matches!(expression, Expression::UnaryExpression(unary) if unary.operator.as_str() == "void")
    {
        return BranchTuple {
            is_complete: true,
            ..BranchTuple::default()
        };
    }
    if let Expression::StringLiteral(literal) = expression {
        return BranchTuple {
            combined: literal.value.eq_ignore_ascii_case("_blank"),
            is_complete: true,
            ..BranchTuple::default()
        };
    }
    if expression.is_literal() {
        return BranchTuple {
            is_complete: true,
            ..BranchTuple::default()
        };
    }
    match expression {
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => BranchTuple {
            combined: template_text(template).eq_ignore_ascii_case("_blank"),
            is_complete: true,
            ..BranchTuple::default()
        },
        Expression::ConditionalExpression(conditional) => {
            let mut consequent_visited = visited_symbol_ids.clone();
            let consequent =
                match_target_expression(&conditional.consequent, ctx, &mut consequent_visited);
            let mut alternate_visited = visited_symbol_ids.clone();
            let alternate =
                match_target_expression(&conditional.alternate, ctx, &mut alternate_visited);
            let predicate =
                resolve_conditional_predicate(&conditional.test, ctx, &mut FxHashSet::default());
            BranchTuple {
                combined: consequent.combined || alternate.combined,
                is_complete: consequent.is_complete && alternate.is_complete,
                test_key: predicate
                    .as_ref()
                    .map_or_else(String::new, |predicate| predicate.key.clone()),
                consequent: predicate.as_ref().map_or(consequent.combined, |predicate| {
                    if predicate.is_negated {
                        alternate.combined
                    } else {
                        consequent.combined
                    }
                }),
                alternate: predicate.as_ref().map_or(alternate.combined, |predicate| {
                    if predicate.is_negated {
                        consequent.combined
                    } else {
                        alternate.combined
                    }
                }),
            }
        }
        _ => BranchTuple::default(),
    }
}

fn resolve_const_expression<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> &'b Expression<'a> {
    let expression = expression.get_inner_expression();
    let Expression::Identifier(identifier) = expression else {
        return expression;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return expression;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return expression;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
        || !visited_symbol_ids.insert(symbol_id)
    {
        return expression;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return expression;
    };
    resolve_const_expression(initializer, ctx, visited_symbol_ids)
}

fn resolve_conditional_predicate(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<ConditionalPredicate> {
    let expression = expression.get_inner_expression();
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator.as_str() == "!"
    {
        let mut predicate =
            resolve_conditional_predicate(&unary.argument, ctx, visited_symbol_ids)?;
        predicate.is_negated = !predicate.is_negated;
        return Some(predicate);
    }
    if let Expression::LogicalExpression(logical) = expression {
        let left = resolve_conditional_predicate(&logical.left, ctx, visited_symbol_ids)?;
        let right = resolve_conditional_predicate(&logical.right, ctx, visited_symbol_ids)?;
        return Some(ConditionalPredicate {
            is_negated: false,
            key: format!(
                "logical:{}:{}:{}:{}:{}",
                logical.operator.as_str(),
                left.key,
                left.is_negated,
                right.key,
                right.is_negated
            ),
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let Some(symbol_id) = reference.symbol_id() else {
        return Some(ConditionalPredicate {
            is_negated: false,
            key: format!("unresolved:{}", identifier.name),
        });
    };
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| !reference.is_read() || reference.is_write())
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
        )
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && let Some(initializer) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        && (matches!(initializer, Expression::Identifier(_))
            || matches!(
                initializer,
                Expression::UnaryExpression(unary) if unary.operator.as_str() == "!"
            ))
        && visited_symbol_ids.insert(symbol_id)
    {
        let predicate = resolve_conditional_predicate(initializer, ctx, visited_symbol_ids);
        visited_symbol_ids.remove(&symbol_id);
        if predicate.is_some() {
            return predicate;
        }
    }
    Some(ConditionalPredicate {
        is_negated: false,
        key: format!("symbol:{symbol_id:?}"),
    })
}

fn target_blank_has_possible_static_property_mutation_or_escape_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    property_name: &str,
    reference_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if has_possible_static_property_write_before(
        identifier,
        property_name,
        reference_node,
        analysis,
        ctx,
    ) {
        return true;
    }
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            !target_blank_is_non_mutating_static_property_reference(identifier_node, ctx)
                && can_node_execute_before(identifier_node, reference_node, analysis, ctx)
        })
}

fn target_blank_is_non_mutating_static_property_reference<'a>(
    identifier_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if target_blank_is_direct_alias_source_reference(identifier_node, ctx) {
        return true;
    }
    let identifier_root = transparent_expression_root(identifier_node, ctx);
    let member_node = ctx.nodes().parent_node(identifier_root.id());
    let object_span = match member_node.kind() {
        AstKind::StaticMemberExpression(member) => member.object.span(),
        AstKind::ComputedMemberExpression(member) => member.object.span(),
        _ => return false,
    };
    if object_span != identifier_root.span() {
        return false;
    }
    let member_root = transparent_expression_root(member_node, ctx);
    !matches!(
        ctx.nodes().parent_node(member_root.id()).kind(),
        AstKind::CallExpression(call) if call.callee.span() == member_root.span()
    )
}

fn target_blank_is_direct_alias_source_reference<'a>(
    identifier_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let identifier_root = transparent_expression_root(identifier_node, ctx);
    let parent = ctx.nodes().parent_node(identifier_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == identifier_root.span()) =>
        {
            declarator.id.get_binding_identifier().is_some()
                || matches!(&declarator.id, BindingPattern::ObjectPattern(_))
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator.as_str() == "="
                && assignment.right.span() == identifier_root.span() =>
        {
            matches!(
                &assignment.left,
                oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(_)
            )
        }
        _ => false,
    }
}

fn check_rel_value(value: &str, allow_referrer: bool) -> bool {
    value.split(is_javascript_whitespace).any(|token| {
        token.eq_ignore_ascii_case("noreferrer")
            || (allow_referrer && token.eq_ignore_ascii_case("noopener"))
    })
}

fn is_external_link(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.starts_with(b"//") {
        return true;
    }
    if bytes.first().is_none_or(|byte| !byte.is_ascii_alphabetic()) {
        return false;
    }
    let mut index = 1;
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
    {
        index += 1;
    }
    bytes.get(index) == Some(&b':') && bytes.get(index + 1..index + 3) == Some(b"//")
}

fn template_text<'a>(template: &'a oxc_ast::ast::TemplateLiteral<'a>) -> &'a str {
    template.quasis.first().map_or("", |quasi| {
        quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
    })
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}
