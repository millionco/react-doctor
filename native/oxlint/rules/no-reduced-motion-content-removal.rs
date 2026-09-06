use oxc_ast::{
    ast::{
        BindingPattern, Expression, FunctionType, JSXAttributeValue, JSXChild, JSXElement,
        JSXElementName, JSXOpeningElement,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const TAILWIND_BREAKPOINT_NAMES: [&str; 6] = ["", "sm", "md", "lg", "xl", "2xl"];
const TAILWIND_MESSAGE: &str = "This reduced-motion utility hides meaningful content or an action. Keep equivalent content available and remove only the spatial motion.";
const HOOK_MESSAGE: &str = "This useReducedMotion branch removes meaningful content or an action. Render an equivalent static presentation instead of null.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReducedMotionVisibility {
    Hidden,
    Unknown,
    Visible,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReducedMotionVisibilityOverride {
    Hidden,
    Unknown,
    Unset,
    Visible,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReducedMotionStaticStatus {
    Absent,
    Known,
    Unknown,
}

struct ReducedMotionStaticString {
    status: ReducedMotionStaticStatus,
    value: String,
}

struct ReducedMotionStaticBoolean {
    status: ReducedMotionStaticStatus,
    value: bool,
}

#[derive(Default, PartialEq, Eq)]
struct ReducedMotionSemanticSummary {
    action_identities: Vec<String>,
    has_unknown_semantics: bool,
    live_region_identities: Vec<String>,
    static_text_parts: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct NoReducedMotionContentRemoval;

declare_oxc_lint!(
    /// Disallow removing meaningful content for users who prefer reduced motion.
    NoReducedMotionContentRemoval,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow reduced-motion content removal.",
);

impl Rule for NoReducedMotionContentRemoval {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                if !has_capability_or_unspecified(ctx, "tailwind")
                    || reduced_motion_intrinsic_tag_name(opening_element).is_none()
                    || has_any_jsx_spread_attribute(opening_element)
                {
                    return;
                }
                let Some(class_name) = get_static_class_name(opening_element) else {
                    return;
                };
                let element_node = ctx.nodes().parent_node(node.id());
                let AstKind::JSXElement(element) = element_node.kind() else {
                    return;
                };
                if !reduced_motion_directly_reaches_rendered_output(element_node, ctx) {
                    return;
                }
                let tokens = tailwind_class_name_tokens(class_name);
                for reduced_scope in reduced_motion_effective_scopes(&tokens) {
                    if !reduced_motion_root_and_ancestors_visible_before_removal(
                        element_node,
                        &reduced_scope,
                        ctx,
                    ) {
                        continue;
                    }
                    let display_visibility = reduced_motion_tailwind_visibility(
                        &tokens,
                        &reduced_scope,
                        TailwindVisibilityProperty::Display,
                    );
                    let visibility_visibility = reduced_motion_tailwind_visibility(
                        &tokens,
                        &reduced_scope,
                        TailwindVisibilityProperty::Visibility,
                    );
                    if display_visibility != Some(false)
                        && visibility_visibility == Some(false)
                        && reduced_motion_descendant_visibility_escape(
                            &element.children,
                            &reduced_scope,
                            ctx,
                        )
                    {
                        continue;
                    }
                    let normal_scope = reduced_motion_normal_scope(&reduced_scope);
                    let summary =
                        reduced_motion_summarize_element(element, &normal_scope, ctx, true);
                    if !reduced_motion_has_meaningful_semantics(&summary)
                        || reduced_motion_has_possible_sibling_fallback(
                            element_node,
                            &summary,
                            &reduced_scope,
                            ctx,
                        )
                    {
                        continue;
                    }
                    ctx.diagnostic(
                        OxcDiagnostic::warn(TAILWIND_MESSAGE).with_label(opening_element.span),
                    );
                    return;
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                if !reduced_motion_directly_reaches_rendered_output(node, ctx)
                    || !reduced_motion_rendered_ancestors_visible(node, &["motion-safe"], ctx)
                    || !reduced_motion_rendered_ancestors_visible(node, &["motion-reduce"], ctx)
                {
                    return;
                }
                let Some(condition) =
                    reduced_motion_condition(&conditional.test, ctx, &mut Vec::new())
                else {
                    return;
                };
                let (reduced_branch, motion_branch) = if condition {
                    (&conditional.consequent, &conditional.alternate)
                } else {
                    (&conditional.alternate, &conditional.consequent)
                };
                if !matches!(
                    reduced_branch.get_inner_expression(),
                    Expression::NullLiteral(_)
                ) {
                    return;
                }
                let summary =
                    reduced_motion_summarize_expression(motion_branch, &["motion-safe"], ctx);
                if !reduced_motion_has_meaningful_semantics(&summary)
                    || reduced_motion_rendered_sibling_anchor(node, ctx).is_some_and(|anchor| {
                        reduced_motion_has_possible_sibling_fallback(
                            anchor,
                            &summary,
                            &["motion-reduce"],
                            ctx,
                        )
                    })
                {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(HOOK_MESSAGE).with_label(conditional.span));
            }
            _ => {}
        }
    }
}

fn reduced_motion_effective_scopes<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> Vec<Vec<&'a str>> {
    let mut scopes = Vec::new();
    for token in tokens {
        if !matches!(token.utility, "hidden" | "invisible")
            || !token
                .variants
                .iter()
                .any(|variant| reduced_motion_is_reduce_variant(variant))
            || !reduced_motion_supported_scope(&token.variants)
        {
            continue;
        }
        let property = if token.utility == "hidden" {
            TailwindVisibilityProperty::Display
        } else {
            TailwindVisibilityProperty::Visibility
        };
        if reduced_motion_tailwind_visibility(tokens, &token.variants, property) != Some(false)
            || scopes
                .iter()
                .any(|scope: &Vec<&str>| scope.as_slice() == token.variants.as_slice())
        {
            continue;
        }
        scopes.push(token.variants.clone());
    }
    scopes
}

fn reduced_motion_is_reduce_variant(variant: &str) -> bool {
    variant.split('/').next() == Some("motion-reduce")
}

fn reduced_motion_is_safe_variant(variant: &str) -> bool {
    variant.split('/').next() == Some("motion-safe")
}

fn reduced_motion_supported_scope(variants: &[&str]) -> bool {
    if variants.iter().any(|variant| {
        if reduced_motion_is_reduce_variant(variant) || reduced_motion_is_safe_variant(variant) {
            return *variant != "motion-reduce" && *variant != "motion-safe";
        }
        let breakpoint_index = TAILWIND_BREAKPOINT_NAMES
            .iter()
            .position(|breakpoint| breakpoint == variant)
            .unwrap_or_default();
        if breakpoint_index > 0 {
            return false;
        }
        variant.strip_prefix("max-").is_none_or(|breakpoint| {
            TAILWIND_BREAKPOINT_NAMES
                .iter()
                .position(|candidate| *candidate == breakpoint)
                .unwrap_or_default()
                <= 0
        })
    }) {
        return false;
    }
    if variants
        .iter()
        .any(|variant| reduced_motion_is_reduce_variant(variant))
        && variants
            .iter()
            .any(|variant| reduced_motion_is_safe_variant(variant))
    {
        return false;
    }
    let normalized = variants
        .iter()
        .map(|variant| variant.split('/').next().unwrap_or_default())
        .collect::<Vec<_>>();
    if normalized.iter().any(|variant| {
        variant
            .strip_prefix("not-")
            .is_some_and(|positive| normalized.contains(&positive))
    }) {
        return false;
    }
    let mut minimum_breakpoint = 0;
    let mut maximum_breakpoint = TAILWIND_BREAKPOINT_NAMES.len();
    for variant in variants {
        if let Some(index) = TAILWIND_BREAKPOINT_NAMES
            .iter()
            .position(|breakpoint| breakpoint == variant)
            .filter(|index| *index > 0)
        {
            minimum_breakpoint = minimum_breakpoint.max(index);
        }
        if let Some(index) = variant.strip_prefix("max-").and_then(|breakpoint| {
            TAILWIND_BREAKPOINT_NAMES
                .iter()
                .position(|candidate| *candidate == breakpoint)
                .filter(|index| *index > 0)
        }) {
            maximum_breakpoint = maximum_breakpoint.min(index);
        }
    }
    minimum_breakpoint < maximum_breakpoint
}

fn reduced_motion_normal_scope<'a>(reduced_scope: &[&'a str]) -> Vec<&'a str> {
    reduced_scope
        .iter()
        .map(|variant| {
            if reduced_motion_is_reduce_variant(variant) {
                "motion-safe"
            } else {
                *variant
            }
        })
        .collect()
}

fn reduced_motion_tailwind_visibility(
    tokens: &[TailwindClassNameToken<'_>],
    target_scope: &[&str],
    property: TailwindVisibilityProperty,
) -> Option<bool> {
    let resolution = resolve_effective_tailwind_class_name_token(
        tokens,
        |utility| match get_tailwind_visibility_effect(utility) {
            TailwindVisibilityEffectResolution::Known(effect) => effect.property == property,
            TailwindVisibilityEffectResolution::Unknown => {
                reduced_motion_unknown_visibility_property(utility) == Some(property)
            }
            TailwindVisibilityEffectResolution::NotRelevant => false,
        },
        target_scope,
    );
    if resolution.is_ambiguous {
        return None;
    }
    let Some(utility) = resolution.utility else {
        return Some(true);
    };
    match get_tailwind_visibility_effect(utility) {
        TailwindVisibilityEffectResolution::Known(effect) => Some(effect.is_visible),
        TailwindVisibilityEffectResolution::Unknown => None,
        TailwindVisibilityEffectResolution::NotRelevant => Some(true),
    }
}

fn reduced_motion_unknown_visibility_property(utility: &str) -> Option<TailwindVisibilityProperty> {
    if utility.to_ascii_lowercase().starts_with("[display:") {
        Some(TailwindVisibilityProperty::Display)
    } else if utility.to_ascii_lowercase().starts_with("[visibility:") {
        Some(TailwindVisibilityProperty::Visibility)
    } else {
        None
    }
}

fn reduced_motion_intrinsic_tag_name<'a>(opening: &'a JSXOpeningElement<'a>) -> Option<&'a str> {
    let JSXElementName::Identifier(identifier) = &opening.name else {
        return None;
    };
    let name = identifier.name.as_str();
    (name == name.to_lowercase()).then_some(name)
}

fn reduced_motion_element_visibility<'a>(
    opening: &JSXOpeningElement<'a>,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) -> ReducedMotionVisibility {
    let non_tailwind = reduced_motion_non_tailwind_visibility(opening, ctx);
    if non_tailwind != ReducedMotionVisibility::Visible {
        return non_tailwind;
    }
    if get_authoritative_jsx_attribute(opening, "className", true).is_none() {
        return ReducedMotionVisibility::Visible;
    }
    let Some(class_name) = get_static_class_name(opening) else {
        return ReducedMotionVisibility::Unknown;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    match (
        reduced_motion_tailwind_visibility(
            &tokens,
            target_scope,
            TailwindVisibilityProperty::Display,
        ),
        reduced_motion_tailwind_visibility(
            &tokens,
            target_scope,
            TailwindVisibilityProperty::Visibility,
        ),
    ) {
        (Some(true), Some(true)) => ReducedMotionVisibility::Visible,
        (Some(_), Some(_)) => ReducedMotionVisibility::Hidden,
        _ => ReducedMotionVisibility::Unknown,
    }
}

fn reduced_motion_non_tailwind_visibility<'a>(
    opening: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> ReducedMotionVisibility {
    let Some(tag_name) = reduced_motion_intrinsic_tag_name(opening) else {
        return ReducedMotionVisibility::Unknown;
    };
    if has_any_jsx_spread_attribute(opening) {
        return ReducedMotionVisibility::Unknown;
    }
    let hidden = reduced_motion_static_boolean(opening, "hidden", false);
    if hidden.status == ReducedMotionStaticStatus::Unknown {
        return ReducedMotionVisibility::Unknown;
    }
    if hidden.status == ReducedMotionStaticStatus::Known && hidden.value {
        return ReducedMotionVisibility::Hidden;
    }
    let aria_hidden = reduced_motion_aria_hidden(opening);
    if aria_hidden.status == ReducedMotionStaticStatus::Unknown {
        return ReducedMotionVisibility::Unknown;
    }
    if aria_hidden.status == ReducedMotionStaticStatus::Known && aria_hidden.value {
        return ReducedMotionVisibility::Hidden;
    }
    if tag_name == "input" {
        let input_type = reduced_motion_static_string(opening, "type", false);
        if input_type.status == ReducedMotionStaticStatus::Unknown {
            return ReducedMotionVisibility::Unknown;
        }
        if input_type.status == ReducedMotionStaticStatus::Known
            && input_type.value.eq_ignore_ascii_case("hidden")
        {
            return ReducedMotionVisibility::Hidden;
        }
    }
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening, "style", false) {
        let Some(style) = get_inline_style_object_expression_with_aliases(style_attribute, ctx)
        else {
            return ReducedMotionVisibility::Unknown;
        };
        if style.properties.iter().any(|property| {
            !matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())
        }) {
            return ReducedMotionVisibility::Unknown;
        }
        for property_name in ["display", "visibility"] {
            let Some(property) = get_effective_static_style_property(style, property_name) else {
                continue;
            };
            let Some(value) = get_object_property_string_value(property) else {
                return ReducedMotionVisibility::Unknown;
            };
            let value = value.trim().to_ascii_lowercase();
            if property_name == "display" && value == "none"
                || property_name == "visibility" && matches!(value.as_str(), "hidden" | "collapse")
            {
                return ReducedMotionVisibility::Hidden;
            }
            if property_name == "display"
                && !matches!(
                    value.as_str(),
                    "block"
                        | "contents"
                        | "flex"
                        | "flow-root"
                        | "grid"
                        | "inline"
                        | "inline-block"
                        | "inline-flex"
                        | "inline-grid"
                        | "inline-table"
                        | "list-item"
                        | "table"
                        | "table-caption"
                        | "table-cell"
                        | "table-column"
                        | "table-column-group"
                        | "table-footer-group"
                        | "table-header-group"
                        | "table-row"
                        | "table-row-group"
                )
                || property_name == "visibility" && value != "visible"
            {
                return ReducedMotionVisibility::Unknown;
            }
        }
    }
    ReducedMotionVisibility::Visible
}

fn reduced_motion_root_and_ancestors_visible_before_removal<'a>(
    element_node: &AstNode<'a>,
    reduced_scope: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::JSXElement(element) = element_node.kind() else {
        return false;
    };
    let normal_scope = reduced_motion_normal_scope(reduced_scope);
    if reduced_motion_element_visibility(&element.opening_element, &normal_scope, ctx)
        != ReducedMotionVisibility::Visible
    {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(element_node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(ancestor_element) => {
                if reduced_motion_element_visibility(
                    &ancestor_element.opening_element,
                    &normal_scope,
                    ctx,
                ) != ReducedMotionVisibility::Visible
                    || reduced_motion_element_visibility(
                        &ancestor_element.opening_element,
                        reduced_scope,
                        ctx,
                    ) != ReducedMotionVisibility::Visible
                {
                    return false;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    true
}

fn reduced_motion_descendant_visibility_escape<'a>(
    children: &[JSXChild<'a>],
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Element(element) => {
            let Some(tag_name) = reduced_motion_intrinsic_tag_name(&element.opening_element) else {
                return true;
            };
            if tag_name == "template" {
                return false;
            }
            match reduced_motion_explicit_visibility(&element.opening_element, target_scope, ctx) {
                ReducedMotionVisibilityOverride::Visible
                | ReducedMotionVisibilityOverride::Unknown => true,
                ReducedMotionVisibilityOverride::Hidden
                | ReducedMotionVisibilityOverride::Unset => {
                    reduced_motion_descendant_visibility_escape(
                        &element.children,
                        target_scope,
                        ctx,
                    )
                }
            }
        }
        JSXChild::Fragment(fragment) => {
            reduced_motion_descendant_visibility_escape(&fragment.children, target_scope, ctx)
        }
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| !reduced_motion_static_child_expression(expression).0),
        JSXChild::Spread(_) => true,
        _ => false,
    })
}

fn reduced_motion_explicit_visibility<'a>(
    opening: &JSXOpeningElement<'a>,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) -> ReducedMotionVisibilityOverride {
    if reduced_motion_intrinsic_tag_name(opening).is_none() || has_any_jsx_spread_attribute(opening)
    {
        return ReducedMotionVisibilityOverride::Unknown;
    }
    let inline_visibility = if let Some(style_attribute) =
        get_authoritative_jsx_attribute(opening, "style", false)
    {
        let Some(style) = get_inline_style_object_expression_with_aliases(style_attribute, ctx)
        else {
            return ReducedMotionVisibilityOverride::Unknown;
        };
        if style.properties.iter().any(|property| {
            !matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())
        }) {
            return ReducedMotionVisibilityOverride::Unknown;
        }
        match get_effective_static_style_property(style, "visibility") {
            None => ReducedMotionVisibilityOverride::Unset,
            Some(property) => match get_object_property_string_value(property)
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("visible") => ReducedMotionVisibilityOverride::Visible,
                Some("hidden" | "collapse") => ReducedMotionVisibilityOverride::Hidden,
                _ => ReducedMotionVisibilityOverride::Unknown,
            },
        }
    } else {
        ReducedMotionVisibilityOverride::Unset
    };
    if get_authoritative_jsx_attribute(opening, "className", true).is_none() {
        return inline_visibility;
    }
    let Some(class_name) = get_static_class_name(opening) else {
        return ReducedMotionVisibilityOverride::Unknown;
    };
    let class_visibility = {
        let tokens = tailwind_class_name_tokens(class_name);
        let resolution = resolve_effective_tailwind_class_name_token(
            &tokens,
            |utility| {
                matches!(
                    get_tailwind_visibility_effect(utility),
                    TailwindVisibilityEffectResolution::Known(TailwindVisibilityEffect {
                        property: TailwindVisibilityProperty::Visibility,
                        ..
                    })
                ) || reduced_motion_unknown_visibility_property(utility)
                    == Some(TailwindVisibilityProperty::Visibility)
            },
            target_scope,
        );
        if resolution.is_ambiguous {
            ReducedMotionVisibilityOverride::Unknown
        } else if let Some(utility) = resolution.utility {
            match get_tailwind_visibility_effect(utility) {
                TailwindVisibilityEffectResolution::Known(effect) if effect.is_visible => {
                    ReducedMotionVisibilityOverride::Visible
                }
                TailwindVisibilityEffectResolution::Known(_) => {
                    ReducedMotionVisibilityOverride::Hidden
                }
                _ => ReducedMotionVisibilityOverride::Unknown,
            }
        } else {
            ReducedMotionVisibilityOverride::Unset
        }
    };
    if class_visibility == ReducedMotionVisibilityOverride::Unknown
        || inline_visibility == ReducedMotionVisibilityOverride::Unknown
    {
        return ReducedMotionVisibilityOverride::Unknown;
    }
    if class_visibility == ReducedMotionVisibilityOverride::Unset {
        return inline_visibility;
    }
    if inline_visibility == ReducedMotionVisibilityOverride::Unset
        || inline_visibility == class_visibility
    {
        return class_visibility;
    }
    ReducedMotionVisibilityOverride::Unknown
}

fn reduced_motion_summarize_element<'a>(
    element: &JSXElement<'a>,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
    skip_root_tailwind_visibility: bool,
) -> ReducedMotionSemanticSummary {
    let mut summary = ReducedMotionSemanticSummary::default();
    let opening = &element.opening_element;
    let Some(tag_name) = reduced_motion_intrinsic_tag_name(opening) else {
        summary.has_unknown_semantics = true;
        return summary;
    };
    if has_any_jsx_spread_attribute(opening) {
        summary.has_unknown_semantics = true;
        return summary;
    }
    let visibility = if skip_root_tailwind_visibility {
        reduced_motion_non_tailwind_visibility(opening, ctx)
    } else {
        reduced_motion_element_visibility(opening, target_scope, ctx)
    };
    if visibility == ReducedMotionVisibility::Unknown {
        summary.has_unknown_semantics = true;
    }
    if visibility != ReducedMotionVisibility::Visible {
        return summary;
    }
    if matches!(tag_name, "svg" | "canvas" | "template") {
        return summary;
    }
    for child in &element.children {
        reduced_motion_merge_child_summary(&mut summary, child, target_scope, ctx);
    }
    let role = reduced_motion_static_string(opening, "role", false);
    if role.status == ReducedMotionStaticStatus::Unknown {
        summary.has_unknown_semantics = true;
    }
    let role_value = role.value.to_ascii_lowercase();
    if !matches!(role_value.as_str(), "none" | "presentation") {
        if tag_name == "output" || matches!(role_value.as_str(), "alert" | "log" | "status") {
            summary
                .live_region_identities
                .push(if tag_name == "output" {
                    "output".to_string()
                } else {
                    format!("role:{role_value}")
                });
        }
        let aria_live = reduced_motion_static_string(opening, "aria-live", false);
        if aria_live.status == ReducedMotionStaticStatus::Unknown {
            summary.has_unknown_semantics = true;
        }
        let aria_live_value = aria_live.value.to_ascii_lowercase();
        if matches!(aria_live_value.as_str(), "assertive" | "polite") {
            summary
                .live_region_identities
                .push(format!("aria-live:{aria_live_value}"));
        }
        match reduced_motion_action_identity(element, &summary, ctx) {
            Ok(Some(identity)) => summary.action_identities.push(identity),
            Ok(None) => {}
            Err(()) => summary.has_unknown_semantics = true,
        }
    }
    summary
}

fn reduced_motion_merge_child_summary<'a>(
    summary: &mut ReducedMotionSemanticSummary,
    child: &JSXChild<'a>,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) {
    match child {
        JSXChild::Text(text) => summary.static_text_parts.push(text.value.to_string()),
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return;
            };
            let (is_known, value) = reduced_motion_static_child_expression(expression);
            if is_known {
                if !value.is_empty() {
                    summary.static_text_parts.push(value);
                }
            } else {
                summary.has_unknown_semantics = true;
            }
        }
        JSXChild::Element(element) => {
            let child_summary = reduced_motion_summarize_element(element, target_scope, ctx, false);
            reduced_motion_merge_summary(summary, child_summary);
        }
        JSXChild::Fragment(fragment) => {
            for child in &fragment.children {
                reduced_motion_merge_child_summary(summary, child, target_scope, ctx);
            }
        }
        JSXChild::Spread(_) => summary.has_unknown_semantics = true,
    }
}

fn reduced_motion_static_child_expression(expression: &Expression<'_>) -> (bool, String) {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => (true, literal.value.to_string()),
        Expression::NumericLiteral(literal) => (true, literal.value.to_string()),
        Expression::BigIntLiteral(literal) => (true, literal.value.to_string()),
        Expression::BooleanLiteral(_) | Expression::NullLiteral(_) => (true, String::new()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            (
                true,
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        _ => (false, String::new()),
    }
}

fn reduced_motion_merge_summary(
    target: &mut ReducedMotionSemanticSummary,
    source: ReducedMotionSemanticSummary,
) {
    target.action_identities.extend(source.action_identities);
    target
        .live_region_identities
        .extend(source.live_region_identities);
    target.static_text_parts.extend(source.static_text_parts);
    target.has_unknown_semantics |= source.has_unknown_semantics;
}

fn reduced_motion_action_identity(
    element: &JSXElement<'_>,
    summary: &ReducedMotionSemanticSummary,
    ctx: &LintContext<'_>,
) -> Result<Option<String>, ()> {
    let opening = &element.opening_element;
    let Some(tag_name) = reduced_motion_intrinsic_tag_name(opening) else {
        return Err(());
    };
    if !matches!(tag_name, "a" | "area" | "button") {
        return Ok(None);
    }
    if get_authoritative_jsx_attribute(opening, "aria-labelledby", false).is_some() {
        return Err(());
    }
    let aria_label = reduced_motion_static_string(opening, "aria-label", false);
    if aria_label.status == ReducedMotionStaticStatus::Unknown {
        return Err(());
    }
    let name = if aria_label.status == ReducedMotionStaticStatus::Known {
        aria_label.value.trim().to_string()
    } else if summary.has_unknown_semantics {
        return Err(());
    } else {
        reduced_motion_normalized_text(&summary.static_text_parts)
    };
    if !name.chars().any(char::is_alphanumeric) {
        return Err(());
    }
    if matches!(tag_name, "a" | "area") {
        let href = reduced_motion_static_string(opening, "href", false);
        return match href.status {
            ReducedMotionStaticStatus::Known if !href.value.is_empty() => {
                Ok(Some(format!("{tag_name}|{}|{name}", href.value)))
            }
            ReducedMotionStaticStatus::Absent => Ok(None),
            _ => Err(()),
        };
    }
    let disabled = reduced_motion_static_boolean(opening, "disabled", false);
    if disabled.status == ReducedMotionStaticStatus::Unknown {
        return Err(());
    }
    if disabled.status == ReducedMotionStaticStatus::Known && disabled.value {
        return Ok(Some(format!("button|disabled|{name}")));
    }
    let button_type = reduced_motion_static_string(opening, "type", false);
    if button_type.status == ReducedMotionStaticStatus::Unknown {
        return Err(());
    }
    let button_type = if button_type.status == ReducedMotionStaticStatus::Known {
        button_type.value.to_ascii_lowercase()
    } else {
        "submit".to_string()
    };
    let form = reduced_motion_static_string(opening, "form", false);
    let form_action = reduced_motion_static_string(opening, "formAction", false);
    if matches!(button_type.as_str(), "submit" | "reset")
        && (form.status == ReducedMotionStaticStatus::Unknown
            || form_action.status == ReducedMotionStaticStatus::Unknown)
    {
        return Err(());
    }
    let form_behavior = if matches!(button_type.as_str(), "submit" | "reset") {
        format!("form:{}:{}", form.value, form_action.value)
    } else {
        "no-form-action".to_string()
    };
    if let Some(on_click) = get_authoritative_jsx_attribute(opening, "onClick", false) {
        let Some(Expression::Identifier(identifier)) =
            jsx_attribute_expression(on_click).map(Expression::get_inner_expression)
        else {
            return Err(());
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return Err(());
        };
        return Ok(Some(format!(
            "button|{button_type}|{form_behavior}|click:{symbol_id:?}|{name}"
        )));
    }
    if !matches!(button_type.as_str(), "submit" | "reset") {
        Ok(Some(format!("button|{button_type}|no-action|{name}")))
    } else {
        Ok(Some(format!("button|{button_type}|{form_behavior}|{name}")))
    }
}

fn reduced_motion_has_meaningful_semantics(summary: &ReducedMotionSemanticSummary) -> bool {
    !summary.action_identities.is_empty()
        || !summary.live_region_identities.is_empty()
        || reduced_motion_normalized_text(&summary.static_text_parts)
            .chars()
            .any(char::is_alphanumeric)
}

fn reduced_motion_normalized_text(parts: &[String]) -> String {
    parts
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn reduced_motion_has_possible_sibling_fallback<'a>(
    rendered_node: &AstNode<'a>,
    hidden_summary: &ReducedMotionSemanticSummary,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(rendered_node.id());
    let children = match parent.kind() {
        AstKind::JSXElement(element) => &element.children,
        AstKind::JSXFragment(fragment) => &fragment.children,
        _ => return false,
    };
    for sibling in children {
        if sibling.span() == rendered_node.span() {
            continue;
        }
        let sibling_summary = match sibling {
            JSXChild::Text(text) => {
                if !text.value.chars().any(char::is_alphanumeric) {
                    continue;
                }
                ReducedMotionSemanticSummary {
                    static_text_parts: vec![text.value.to_string()],
                    ..ReducedMotionSemanticSummary::default()
                }
            }
            JSXChild::ExpressionContainer(container) => {
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                let (is_known, value) = reduced_motion_static_child_expression(expression);
                if !is_known {
                    return true;
                }
                if !value.chars().any(char::is_alphanumeric) {
                    continue;
                }
                ReducedMotionSemanticSummary {
                    static_text_parts: vec![value],
                    ..ReducedMotionSemanticSummary::default()
                }
            }
            JSXChild::Element(element) => {
                match reduced_motion_element_visibility(&element.opening_element, target_scope, ctx)
                {
                    ReducedMotionVisibility::Hidden => continue,
                    ReducedMotionVisibility::Unknown => return true,
                    ReducedMotionVisibility::Visible => {
                        reduced_motion_summarize_element(element, target_scope, ctx, true)
                    }
                }
            }
            JSXChild::Fragment(fragment) => {
                let mut summary = ReducedMotionSemanticSummary::default();
                for child in &fragment.children {
                    reduced_motion_merge_child_summary(&mut summary, child, target_scope, ctx);
                }
                summary
            }
            JSXChild::Spread(_) => return true,
        };
        if sibling_summary.has_unknown_semantics {
            return true;
        }
        if reduced_motion_summaries_equivalent(hidden_summary, &sibling_summary) {
            return true;
        }
    }
    let AstKind::JSXElement(wrapper) = parent.kind() else {
        return false;
    };
    if !matches!(
        reduced_motion_intrinsic_tag_name(&wrapper.opening_element),
        Some("div" | "section" | "span")
    ) || has_any_jsx_spread_attribute(&wrapper.opening_element)
        || ["role", "aria-live", "aria-label", "aria-labelledby"]
            .iter()
            .any(|attribute_name| {
                reduced_motion_static_string(&wrapper.opening_element, attribute_name, false).status
                    != ReducedMotionStaticStatus::Absent
            })
        || reduced_motion_element_visibility(&wrapper.opening_element, target_scope, ctx)
            != ReducedMotionVisibility::Visible
    {
        return false;
    }
    let wrapper_parent = ctx.nodes().parent_node(parent.id());
    let wrapper_siblings = match wrapper_parent.kind() {
        AstKind::JSXElement(element) => &element.children,
        AstKind::JSXFragment(fragment) => &fragment.children,
        _ => return false,
    };
    let element_siblings = wrapper_siblings
        .iter()
        .filter_map(|child| match child {
            JSXChild::Element(element) => Some(element),
            _ => None,
        })
        .collect::<Vec<_>>();
    if element_siblings.len() != 2 {
        return false;
    }
    let normal_scope = reduced_motion_normal_scope(target_scope);
    for sibling in element_siblings {
        if sibling.span() == wrapper.span() {
            continue;
        }
        let reduced_visibility =
            reduced_motion_element_visibility(&sibling.opening_element, target_scope, ctx);
        let normal_visibility =
            reduced_motion_element_visibility(&sibling.opening_element, &normal_scope, ctx);
        if reduced_visibility == ReducedMotionVisibility::Unknown
            || normal_visibility == ReducedMotionVisibility::Unknown
        {
            return true;
        }
        if reduced_visibility != ReducedMotionVisibility::Visible {
            continue;
        }
        let normal_summary = if normal_visibility == ReducedMotionVisibility::Hidden {
            ReducedMotionSemanticSummary::default()
        } else {
            reduced_motion_summarize_element(sibling, &normal_scope, ctx, true)
        };
        if normal_summary.has_unknown_semantics {
            return true;
        }
        if reduced_motion_has_meaningful_semantics(&normal_summary) {
            continue;
        }
        let sibling_summary = reduced_motion_summarize_element(sibling, target_scope, ctx, true);
        if sibling_summary.has_unknown_semantics
            || reduced_motion_summaries_equivalent(hidden_summary, &sibling_summary)
        {
            return true;
        }
    }
    false
}

fn reduced_motion_summaries_equivalent(
    left: &ReducedMotionSemanticSummary,
    right: &ReducedMotionSemanticSummary,
) -> bool {
    let mut left_actions = left.action_identities.clone();
    let mut right_actions = right.action_identities.clone();
    let mut left_regions = left.live_region_identities.clone();
    let mut right_regions = right.live_region_identities.clone();
    left_actions.sort();
    right_actions.sort();
    left_regions.sort();
    right_regions.sort();
    left_actions == right_actions
        && left_regions == right_regions
        && reduced_motion_normalized_text(&left.static_text_parts)
            == reduced_motion_normalized_text(&right.static_text_parts)
}

fn reduced_motion_static_string(
    opening: &JSXOpeningElement<'_>,
    attribute_name: &str,
    is_case_sensitive: bool,
) -> ReducedMotionStaticString {
    let Some(attribute) =
        get_authoritative_jsx_attribute(opening, attribute_name, is_case_sensitive)
    else {
        return ReducedMotionStaticString {
            status: ReducedMotionStaticStatus::Absent,
            value: String::new(),
        };
    };
    let Some(value) = &attribute.value else {
        return ReducedMotionStaticString {
            status: ReducedMotionStaticStatus::Unknown,
            value: String::new(),
        };
    };
    let text = match value {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .and_then(|expression| match expression.get_inner_expression() {
                Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                Expression::TemplateLiteral(template)
                    if template.expressions.is_empty() && template.quasis.len() == 1 =>
                {
                    let quasi = &template.quasis[0];
                    Some(
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str()),
                    )
                }
                _ => None,
            }),
        _ => None,
    };
    text.map_or(
        ReducedMotionStaticString {
            status: ReducedMotionStaticStatus::Unknown,
            value: String::new(),
        },
        |text| ReducedMotionStaticString {
            status: ReducedMotionStaticStatus::Known,
            value: text.to_string(),
        },
    )
}

fn reduced_motion_static_boolean(
    opening: &JSXOpeningElement<'_>,
    attribute_name: &str,
    is_case_sensitive: bool,
) -> ReducedMotionStaticBoolean {
    let Some(attribute) =
        get_authoritative_jsx_attribute(opening, attribute_name, is_case_sensitive)
    else {
        return ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Absent,
            value: false,
        };
    };
    let Some(value) = &attribute.value else {
        return ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Known,
            value: true,
        };
    };
    let truthiness = match value {
        JSXAttributeValue::StringLiteral(literal) => Some(!literal.value.is_empty()),
        JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .and_then(|expression| match expression.get_inner_expression() {
                Expression::RegExpLiteral(_) => Some(true),
                _ => reduced_motion_static_truthiness(expression),
            }),
        _ => None,
    };
    truthiness.map_or(
        ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Unknown,
            value: false,
        },
        |truthiness| ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Known,
            value: truthiness,
        },
    )
}

fn reduced_motion_aria_hidden(opening: &JSXOpeningElement<'_>) -> ReducedMotionStaticBoolean {
    let Some(attribute) = get_authoritative_jsx_attribute(opening, "aria-hidden", false) else {
        return ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Absent,
            value: false,
        };
    };
    let Some(value) = &attribute.value else {
        return ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Known,
            value: true,
        };
    };
    let resolved = match value {
        JSXAttributeValue::StringLiteral(literal) => {
            Some(literal.value.eq_ignore_ascii_case("true"))
        }
        JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .and_then(|expression| match expression.get_inner_expression() {
                Expression::BooleanLiteral(literal) => Some(literal.value),
                Expression::StringLiteral(literal) => {
                    Some(literal.value.eq_ignore_ascii_case("true"))
                }
                _ => None,
            }),
        _ => None,
    };
    resolved.map_or(
        ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Unknown,
            value: false,
        },
        |value| ReducedMotionStaticBoolean {
            status: ReducedMotionStaticStatus::Known,
            value,
        },
    )
}

fn reduced_motion_static_truthiness(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::NullLiteral(_) => Some(false),
        Expression::NumericLiteral(literal) => {
            Some(literal.value != 0.0 && !literal.value.is_nan())
        }
        Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
        Expression::BigIntLiteral(literal) => Some(!literal.is_zero()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            Some(!template.quasis[0].value.raw.is_empty())
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            reduced_motion_static_truthiness(&unary.argument).map(|value| !value)
        }
        _ => None,
    }
}

fn reduced_motion_condition<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    _visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            reduced_motion_condition(&unary.argument, ctx, _visited_symbols).map(|value| !value)
        }
        Expression::CallExpression(call) => {
            motion_react_api_path_matches(&call.callee, &["useReducedMotion"], ctx).then_some(true)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let AstKind::VariableDeclaration(variable) =
                ctx.nodes().parent_node(declaration.id()).kind()
            else {
                return None;
            };
            if !variable.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            let Expression::CallExpression(call) = initializer else {
                return None;
            };
            motion_react_api_path_matches(&call.callee, &["useReducedMotion"], ctx).then_some(true)
        }
        _ => None,
    }
}

fn reduced_motion_summarize_expression<'a>(
    expression: &Expression<'a>,
    target_scope: &[&str],
    ctx: &LintContext<'a>,
) -> ReducedMotionSemanticSummary {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            reduced_motion_summarize_element(element, target_scope, ctx, false)
        }
        Expression::JSXFragment(fragment) => {
            let mut summary = ReducedMotionSemanticSummary::default();
            for child in &fragment.children {
                reduced_motion_merge_child_summary(&mut summary, child, target_scope, ctx);
            }
            summary
        }
        _ => ReducedMotionSemanticSummary {
            has_unknown_semantics: true,
            ..ReducedMotionSemanticSummary::default()
        },
    }
}

fn reduced_motion_directly_reaches_rendered_output<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    let mut passed_return = false;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                passed_return = true;
                current = parent;
            }
            AstKind::ConditionalExpression(conditional)
                if conditional.consequent.span() == current.span()
                    || conditional.alternate.span() == current.span() =>
            {
                if let Some(test) = reduced_motion_static_truthiness(&conditional.test) {
                    let selected = if test {
                        conditional.consequent.span()
                    } else {
                        conditional.alternate.span()
                    };
                    if selected != current.span() {
                        return false;
                    }
                }
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::LogicalExpression(logical) if logical.right.span() == current.span() => {
                if !reduced_motion_logical_right_can_run(logical) {
                    return false;
                }
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::JSXExpressionContainer(_)
            | AstKind::JSXElement(_)
            | AstKind::JSXFragment(_)
            | AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_) => current = transparent_expression_root(parent, ctx),
            AstKind::ArrowFunctionExpression(arrow) => {
                return reduced_motion_is_component_function(parent, ctx)
                    && (passed_return || arrow.get_expression().is_some());
            }
            AstKind::Function(function) => {
                return passed_return
                    && reduced_motion_is_named_component_function(parent, function.r#type, ctx);
            }
            _ => return false,
        }
    }
}

fn reduced_motion_is_component_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    matches!(
        parent.kind(),
        AstKind::VariableDeclarator(declarator)
            if matches!(&declarator.id, BindingPattern::BindingIdentifier(identifier) if reduced_motion_component_name(identifier.name.as_str()))
    ) || matches!(parent.kind(), AstKind::ExportDefaultDeclaration(_))
}

fn reduced_motion_is_named_component_function(
    node: &AstNode<'_>,
    function_type: FunctionType,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::Function(function) = node.kind() else {
        return false;
    };
    match function_type {
        FunctionType::FunctionDeclaration | FunctionType::TSDeclareFunction => function
            .id
            .as_ref()
            .is_some_and(|identifier| reduced_motion_component_name(identifier.name.as_str())),
        _ => reduced_motion_is_component_function(node, ctx),
    }
}

fn reduced_motion_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn reduced_motion_logical_right_can_run(logical: &oxc_ast::ast::LogicalExpression<'_>) -> bool {
    let left = reduced_motion_static_truthiness(&logical.left);
    match logical.operator {
        oxc_syntax::operator::LogicalOperator::And => left != Some(false),
        oxc_syntax::operator::LogicalOperator::Or => left != Some(true),
        oxc_syntax::operator::LogicalOperator::Coalesce => !matches!(
            logical.left.get_inner_expression(),
            Expression::BooleanLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::StringLiteral(_)
                | Expression::BigIntLiteral(_)
        ),
    }
}

fn reduced_motion_rendered_sibling_anchor<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::JSXExpressionContainer(_) => return Some(parent),
            AstKind::ConditionalExpression(conditional)
                if conditional.consequent.span() == current.span()
                    || conditional.alternate.span() == current.span() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::LogicalExpression(logical) if logical.right.span() == current.span() => {
                current = transparent_expression_root(parent, ctx);
            }
            _ => return None,
        }
    }
}

fn reduced_motion_rendered_ancestors_visible(
    node: &AstNode<'_>,
    target_scope: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(element)
                if reduced_motion_element_visibility(
                    &element.opening_element,
                    target_scope,
                    ctx,
                ) != ReducedMotionVisibility::Visible =>
            {
                return false;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    true
}
