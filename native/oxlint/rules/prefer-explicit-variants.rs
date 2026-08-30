use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, FormalParameters, FunctionType, JSXElementName,
        JSXMemberExpressionObject, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashMap;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD: usize = 2;
const BOOLEAN_PROP_PREFIXES: [&str; 9] = [
    "is", "has", "should", "can", "show", "hide", "enable", "disable", "with",
];
const CROSS_CUTTING_STATE_BOOLEAN_NAMES: [&str; 38] = [
    "isLoading",
    "isPending",
    "isFetching",
    "isRefetching",
    "isSubmitting",
    "isError",
    "isSuccess",
    "isEmpty",
    "isReady",
    "isDirty",
    "isValid",
    "isInvalid",
    "isOpen",
    "isClosed",
    "isVisible",
    "isHidden",
    "isActive",
    "isInactive",
    "isExpanded",
    "isCollapsed",
    "isSelected",
    "isChecked",
    "isDisabled",
    "isEnabled",
    "isFocused",
    "isHovered",
    "isDragging",
    "isFullscreen",
    "isMobile",
    "isDesktop",
    "isTablet",
    "isOnline",
    "isOffline",
    "isLoggedIn",
    "isAuthenticated",
    "isAuthorized",
    "isDark",
    "isLight",
];

#[derive(Debug, Default, Clone)]
pub struct PreferExplicitVariants;

struct PreferExplicitVariantsComponent {
    function_node_id: oxc_semantic::NodeId,
    body_span: Span,
    component_name: String,
    report_span: Span,
    boolean_prop_bindings: Vec<String>,
    variant_branch_props: Vec<String>,
}

declare_oxc_lint!(
    /// Prefer explicit variant components over several boolean-driven subtree switches.
    PreferExplicitVariants,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Prefer explicit variant components.",
);

impl Rule for PreferExplicitVariants {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let mut components = Vec::new();
        let mut component_index_by_function_id = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let component = match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    let Some(identifier) = &function.id else {
                        continue;
                    };
                    let Some(body) = &function.body else {
                        continue;
                    };
                    if !prefer_explicit_variants_is_component_name(identifier.name.as_str()) {
                        continue;
                    }
                    prefer_explicit_variants_component(
                        node.id(),
                        &function.params,
                        body.span,
                        identifier.name.as_str(),
                        identifier.span,
                    )
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !prefer_explicit_variants_is_component_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let (function_node_id, parameters, body_span) = match initializer {
                        Expression::ArrowFunctionExpression(function) => (
                            function.node_id.get(),
                            &function.params,
                            function.body.span(),
                        ),
                        Expression::FunctionExpression(function) => {
                            let Some(body) = &function.body else {
                                continue;
                            };
                            (function.node_id.get(), &function.params, body.span)
                        }
                        _ => continue,
                    };
                    let report_span = Span::new(
                        declarator.id.span().start,
                        declarator
                            .type_annotation
                            .as_ref()
                            .map_or(declarator.id.span().end, |annotation| annotation.span.end),
                    );
                    prefer_explicit_variants_component(
                        function_node_id,
                        parameters,
                        body_span,
                        identifier.name.as_str(),
                        report_span,
                    )
                }
                _ => continue,
            };
            let Some(component) = component else {
                continue;
            };
            component_index_by_function_id.insert(component.function_node_id, components.len());
            components.push(component);
        }
        if components.is_empty() {
            return;
        }

        for candidate in ctx.nodes().iter() {
            let AstKind::ConditionalExpression(conditional_expression) = candidate.kind() else {
                continue;
            };
            let Some(function_node_id) =
                prefer_explicit_variants_nearest_function_node_id(candidate.id(), ctx)
            else {
                continue;
            };
            let Some(component_index) = component_index_by_function_id.get(&function_node_id)
            else {
                continue;
            };
            let component = &mut components[*component_index];
            if !component.body_span.contains_inclusive(candidate.span()) {
                continue;
            }
            let Some(prop_name) = prefer_explicit_variants_boolean_prop_test_name(
                &conditional_expression.test,
                &component.boolean_prop_bindings,
            ) else {
                continue;
            };
            let consequent = conditional_expression.consequent.get_inner_expression();
            let alternate = conditional_expression.alternate.get_inner_expression();
            if !matches!(
                consequent,
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            ) || !matches!(
                alternate,
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            ) || prefer_explicit_variants_is_display_toggle_swap(consequent, alternate)
            {
                continue;
            }
            if !component
                .variant_branch_props
                .iter()
                .any(|existing_prop_name| existing_prop_name == prop_name)
            {
                component.variant_branch_props.push(prop_name.to_string());
            }
        }

        for component in components {
            prefer_explicit_variants_report_component(component, ctx);
        }
    }
}

fn prefer_explicit_variants_component<'a>(
    function_node_id: oxc_semantic::NodeId,
    parameters: &'a FormalParameters<'a>,
    body_span: Span,
    component_name: &str,
    report_span: Span,
) -> Option<PreferExplicitVariantsComponent> {
    let Some(parameter_binding) = prefer_explicit_variants_first_parameter_binding(parameters)
    else {
        return None;
    };
    let BindingPattern::ObjectPattern(object_pattern) = parameter_binding else {
        return None;
    };
    let mut boolean_prop_bindings = Vec::new();
    for property in &object_pattern.properties {
        if property.computed {
            continue;
        }
        let PropertyKey::StaticIdentifier(property_key) = &property.key else {
            continue;
        };
        let property_name = property_key.name.as_str();
        if !prefer_explicit_variants_is_boolean_prefixed_prop_name(property_name)
            || CROSS_CUTTING_STATE_BOOLEAN_NAMES.contains(&property_name)
        {
            continue;
        }
        let local_name = match &property.value {
            BindingPattern::BindingIdentifier(identifier) => identifier.name.as_str(),
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                    continue;
                };
                identifier.name.as_str()
            }
            _ => continue,
        };
        if !boolean_prop_bindings
            .iter()
            .any(|binding_name| binding_name == local_name)
        {
            boolean_prop_bindings.push(local_name.to_string());
        }
    }
    if boolean_prop_bindings.len() < BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD {
        return None;
    }
    Some(PreferExplicitVariantsComponent {
        function_node_id,
        body_span,
        component_name: component_name.to_string(),
        report_span,
        boolean_prop_bindings,
        variant_branch_props: Vec::new(),
    })
}

fn prefer_explicit_variants_report_component(
    component: PreferExplicitVariantsComponent,
    ctx: &LintContext<'_>,
) {
    if component.variant_branch_props.len() < BOOLEAN_PROP_VARIANT_BRANCH_THRESHOLD {
        return;
    }
    let prop_list = component
        .variant_branch_props
        .iter()
        .take(3)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    let overflow = if component.variant_branch_props.len() > 3 {
        "…"
    } else {
        ""
    };
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Component \"{}\" picks which component to render from {} boolean props ({prop_list}{overflow}), which multiplies untestable variants. Split it into explicit variant components so each renders one clear path.",
            component.component_name,
            component.variant_branch_props.len(),
        ))
        .with_label(component.report_span),
    );
}

fn prefer_explicit_variants_first_parameter_binding<'a>(
    parameters: &'a FormalParameters<'a>,
) -> Option<&'a BindingPattern<'a>> {
    if let Some(parameter) = parameters.items.first() {
        return Some(&parameter.pattern);
    }
    let BindingPattern::ArrayPattern(array_pattern) = &parameters.rest.as_ref()?.rest.argument
    else {
        return None;
    };
    if array_pattern.rest.is_some() || array_pattern.elements.len() != 1 {
        return None;
    }
    array_pattern.elements.first()?.as_ref()
}

fn prefer_explicit_variants_boolean_prop_test_name<'a>(
    test: &'a Expression<'a>,
    boolean_prop_bindings: &[String],
) -> Option<&'a str> {
    let mut expression = test.get_inner_expression();
    if let Expression::UnaryExpression(unary_expression) = expression
        && unary_expression.operator == UnaryOperator::LogicalNot
    {
        expression = unary_expression.argument.get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    boolean_prop_bindings
        .iter()
        .any(|binding_name| binding_name == identifier.name.as_str())
        .then_some(identifier.name.as_str())
}

fn prefer_explicit_variants_is_display_toggle_swap(
    consequent: &Expression<'_>,
    alternate: &Expression<'_>,
) -> bool {
    let Some(consequent_name) = prefer_explicit_variants_jsx_element_leaf_name(consequent) else {
        return false;
    };
    let Some(alternate_name) = prefer_explicit_variants_jsx_element_leaf_name(alternate) else {
        return false;
    };
    consequent_name == alternate_name
        || prefer_explicit_variants_is_icon_name(consequent_name)
            && prefer_explicit_variants_is_icon_name(alternate_name)
}

fn prefer_explicit_variants_jsx_element_leaf_name<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a str> {
    let Expression::JSXElement(element) = expression else {
        return None;
    };
    match &element.opening_element.name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        JSXElementName::MemberExpression(member_expression)
            if prefer_explicit_variants_jsx_member_has_identifier_root(member_expression) =>
        {
            Some(member_expression.property.name.as_str())
        }
        JSXElementName::MemberExpression(_) => None,
        JSXElementName::NamespacedName(_) | JSXElementName::ThisExpression(_) => None,
    }
}

fn prefer_explicit_variants_jsx_member_has_identifier_root(
    member_expression: &oxc_ast::ast::JSXMemberExpression<'_>,
) -> bool {
    match &member_expression.object {
        JSXMemberExpressionObject::IdentifierReference(_) => true,
        JSXMemberExpressionObject::MemberExpression(parent) => {
            prefer_explicit_variants_jsx_member_has_identifier_root(parent)
        }
        JSXMemberExpressionObject::ThisExpression(_) => false,
    }
}

fn prefer_explicit_variants_is_icon_name(name: &str) -> bool {
    name == "Icon"
        || name.strip_prefix("Icon").is_some_and(|suffix| {
            suffix.as_bytes().first().is_some_and(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            })
        })
        || name.ends_with("Icon")
}

fn prefer_explicit_variants_is_boolean_prefixed_prop_name(name: &str) -> bool {
    BOOLEAN_PROP_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
    })
}

fn prefer_explicit_variants_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn prefer_explicit_variants_nearest_function_node_id(
    node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
