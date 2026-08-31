use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeItem, JSXAttributeValue, ObjectExpression, ObjectProperty,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::get_element_type,
};

const PAINT_PROPERTY_NAMES: [&str; 3] = ["background-color", "border-color", "color"];
const TRANSITION_COLORS_PROPERTY_NAMES: [&str; 6] = [
    "color",
    "background-color",
    "border-color",
    "text-decoration-color",
    "fill",
    "stroke",
];
const TRANSITION_DEFAULT_PROPERTY_NAMES: [&str; 18] = [
    "color",
    "background-color",
    "border-color",
    "text-decoration-color",
    "fill",
    "stroke",
    "opacity",
    "box-shadow",
    "transform",
    "translate",
    "scale",
    "rotate",
    "filter",
    "backdrop-filter",
    "display",
    "content-visibility",
    "overlay",
    "pointer-events",
];
const STABLE_STATE_CONTEXT_VARIANTS: [&str; 14] = [
    "2xl",
    "contrast-less",
    "contrast-more",
    "dark",
    "landscape",
    "lg",
    "ltr",
    "md",
    "motion-reduce",
    "motion-safe",
    "portrait",
    "rtl",
    "sm",
    "xl",
];
const ARIA_CURRENT_ACTIVE_VALUES: [&str; 6] = ["date", "location", "page", "step", "time", "true"];

#[derive(Debug, Default, Clone)]
pub struct NoTransitionedCompositeWidgetState;

declare_oxc_lint!(
    /// Disallow delayed paint feedback for composite-widget state changes.
    NoTransitionedCompositeWidgetState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Composite widget state feedback is delayed.",
);

#[derive(Clone, Copy)]
struct CompositeWidgetStateVariant<'a> {
    selector_value: &'a str,
    state_attribute_name: &'static str,
    state_name: &'static str,
}

#[derive(Clone, Copy)]
struct CanonicalPaintColor {
    alpha: f64,
    blue: f64,
    green: f64,
    red: f64,
}

#[derive(Clone, Copy)]
struct TailwindPaintDeclaration<'a> {
    color: CanonicalPaintColor,
    property_name: &'a str,
}

struct CompositeWidgetDurationEffect {
    is_explicit: bool,
    states: Option<Vec<bool>>,
}

#[derive(Default)]
struct CompositeWidgetAnalysis {
    unconditional_by_cfg_pair: FxHashMap<(oxc_cfg::BlockNodeId, oxc_cfg::BlockNodeId), bool>,
}

impl Rule for NoTransitionedCompositeWidgetState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let mut analysis = CompositeWidgetAnalysis::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
                || !is_proven_intrinsic_jsx_element(opening_element, ctx)
                || !HTML_TAG.contains(get_element_type(ctx, opening_element).as_ref())
            {
                continue;
            }
            let Some(role) = composite_widget_role(opening_element, ctx) else {
                continue;
            };
            let Some(class_name) = get_static_class_name(opening_element) else {
                continue;
            };
            let tokens = tailwind_class_name_tokens(class_name);
            let Some((state_declaration, state_variants)) = effective_state_paint_property(
                node,
                opening_element,
                role,
                &tokens,
                ctx,
                &mut analysis,
            ) else {
                continue;
            };
            if !has_transitioned_paint_property(
                opening_element,
                &tokens,
                &state_variants,
                state_declaration.property_name,
                ctx,
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The {role} transitions its {} when its state changes. Keep high-frequency composite-widget feedback instant.",
                    state_declaration.property_name,
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn composite_widget_role<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let attribute = get_authoritative_jsx_attribute(opening_element, "role", false)?;
    let values = composite_widget_static_attribute_values(attribute, ctx, false)?;
    let mut roles = values
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .collect::<FxHashSet<_>>();
    if roles.len() != 1 {
        return None;
    }
    match roles.drain().next()?.as_str() {
        "option" => Some("option"),
        "menuitem" => Some("menuitem"),
        "menuitemcheckbox" => Some("menuitemcheckbox"),
        "menuitemradio" => Some("menuitemradio"),
        "treeitem" => Some("treeitem"),
        _ => None,
    }
}

fn composite_widget_static_attribute_values(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    ctx: &LintContext<'_>,
    fold_static_conditions: bool,
) -> Option<Vec<String>> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(vec![literal.value.to_string()]),
        JSXAttributeValue::ExpressionContainer(container) => composite_widget_static_string_values(
            container.expression.as_expression()?,
            ctx,
            fold_static_conditions,
            &mut Vec::new(),
        ),
        _ => None,
    }
}

fn composite_widget_static_string_values(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    fold_static_conditions: bool,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(vec![literal.value.to_string()]),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(vec![
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            ])
        }
        Expression::ConditionalExpression(conditional) => {
            if fold_static_conditions
                && let Some(test) =
                    composite_widget_static_boolean(&conditional.test, ctx, &mut Vec::new())
            {
                return composite_widget_static_string_values(
                    if test {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    fold_static_conditions,
                    visited_symbols,
                );
            }
            let mut values = composite_widget_static_string_values(
                &conditional.consequent,
                ctx,
                fold_static_conditions,
                &mut visited_symbols.clone(),
            )?;
            values.extend(composite_widget_static_string_values(
                &conditional.alternate,
                ctx,
                fold_static_conditions,
                &mut visited_symbols.clone(),
            )?);
            Some(values)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let initializer = composite_widget_const_initializer(symbol_id, ctx)?;
            visited_symbols.push(symbol_id);
            let result = composite_widget_static_string_values(
                initializer,
                ctx,
                fold_static_conditions,
                visited_symbols,
            );
            visited_symbols.pop();
            result
        }
        _ => None,
    }
}

fn composite_widget_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable)
        if variable.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn composite_widget_selector_parameter(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<SymbolId> {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            composite_widget_runtime_condition_parameter(&conditional.test, ctx, &mut Vec::new())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let initializer = composite_widget_const_initializer(symbol_id, ctx)?;
            visited_symbols.push(symbol_id);
            let result = composite_widget_selector_parameter(initializer, ctx, visited_symbols);
            visited_symbols.pop();
            result
        }
        _ => None,
    }
}

fn composite_widget_runtime_condition_parameter(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<SymbolId> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            composite_widget_runtime_condition_parameter(&unary.argument, ctx, visited_symbols)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            if composite_widget_is_parameter_declaration(declaration, ctx) {
                return Some(symbol_id);
            }
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let initializer = composite_widget_const_initializer(symbol_id, ctx)?;
            visited_symbols.push(symbol_id);
            let result =
                composite_widget_runtime_condition_parameter(initializer, ctx, visited_symbols);
            visited_symbols.pop();
            result
        }
        _ => None,
    }
}

fn composite_widget_is_parameter_declaration(
    declaration: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(declaration.kind(), AstKind::FormalParameter(_))
        || ctx
            .nodes()
            .ancestors(declaration.id())
            .take_while(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
}

fn composite_widget_expression_references_parameter(
    expression_span: Span,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut pending_symbols = vec![parameter_symbol_id];
    let mut visited_symbols = FxHashSet::default();
    while let Some(symbol_id) = pending_symbols.pop() {
        if !visited_symbols.insert(symbol_id) {
            continue;
        }
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if expression_span.contains_inclusive(reference_node.span()) {
                return true;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == reference_root.span())
                && matches!(ctx.nodes().parent_kind(parent.id()), AstKind::VariableDeclaration(variable)
                    if variable.kind.is_const())
                && let Some(binding) = declarator.id.get_binding_identifier()
            {
                pending_symbols.push(binding.symbol_id());
            }
        }
    }
    false
}

fn composite_widget_can_both_states_reach_element<'a>(
    opening_node: &AstNode<'a>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    analysis: &mut CompositeWidgetAnalysis,
) -> bool {
    if ctx
        .scoping()
        .get_resolved_references(parameter_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    if let Some(key_attribute) = get_authoritative_jsx_attribute(opening_element, "key", false)
        && let Some(JSXAttributeValue::ExpressionContainer(container)) = &key_attribute.value
        && let Some(expression) = container.expression.as_expression()
        && composite_widget_expression_references_parameter(
            expression.span(),
            parameter_symbol_id,
            ctx,
        )
    {
        return false;
    }
    if !composite_widget_is_unconditional_from_entry(opening_node, analysis, ctx)
        || composite_widget_is_mounted_in_parameter_branch(opening_node, parameter_symbol_id, ctx)
        || composite_widget_is_statically_unreachable(opening_node, ctx)
    {
        return false;
    }
    true
}

fn composite_widget_is_mounted_in_parameter_branch(
    opening_node: &AstNode<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(opening_node.id()) {
        let expression = match ancestor.kind() {
            AstKind::IfStatement(statement) => Some(&statement.test),
            AstKind::ConditionalExpression(conditional) => Some(&conditional.test),
            AstKind::LogicalExpression(logical) => Some(&logical.left),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => None,
        };
        if expression.is_some_and(|expression| {
            composite_widget_expression_references_parameter(
                expression.span(),
                parameter_symbol_id,
                ctx,
            )
        }) {
            return true;
        }
    }
    false
}

fn composite_widget_exhaustive_attribute_values<'a>(
    opening_node: &AstNode<'a>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
    ctx: &LintContext<'a>,
    analysis: &mut CompositeWidgetAnalysis,
) -> Option<Vec<String>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, attribute_name, false)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    let expression = container.expression.as_expression()?;
    let parameter_symbol_id =
        composite_widget_selector_parameter(expression, ctx, &mut Vec::new())?;
    if !composite_widget_can_both_states_reach_element(
        opening_node,
        opening_element,
        parameter_symbol_id,
        ctx,
        analysis,
    ) {
        return None;
    }
    composite_widget_static_attribute_values(attribute, ctx, true).map(|values| {
        values
            .into_iter()
            .map(|value| value.trim().to_string())
            .collect()
    })
}

fn composite_widget_state_variant<'a>(variant: &'a str) -> Option<CompositeWidgetStateVariant<'a>> {
    if variant == "aria-checked" || variant == "aria-[checked=true]" {
        return Some(CompositeWidgetStateVariant {
            selector_value: "true",
            state_attribute_name: "aria-checked",
            state_name: "checked",
        });
    }
    if variant == "aria-selected" || variant == "aria-[selected=true]" {
        return Some(CompositeWidgetStateVariant {
            selector_value: "true",
            state_attribute_name: "aria-selected",
            state_name: "selected",
        });
    }
    if variant == "aria-current" || variant == "aria-[current=true]" {
        return Some(CompositeWidgetStateVariant {
            selector_value: "true",
            state_attribute_name: "aria-current",
            state_name: "current",
        });
    }
    let selector_value = variant.strip_prefix("aria-[current=")?.strip_suffix(']')?;
    matches!(
        selector_value,
        "page" | "step" | "location" | "date" | "time"
    )
    .then_some(CompositeWidgetStateVariant {
        selector_value,
        state_attribute_name: "aria-current",
        state_name: "current",
    })
}

fn composite_widget_role_supports_state(role: &str, state_name: &str) -> bool {
    match role {
        "option" => matches!(state_name, "current" | "selected"),
        "menuitem" => state_name == "current",
        "menuitemcheckbox" | "menuitemradio" => matches!(state_name, "checked" | "current"),
        "treeitem" => matches!(state_name, "checked" | "current" | "selected"),
        _ => false,
    }
}

fn composite_widget_get_state_variant<'ast, 'variant>(
    opening_node: &AstNode<'ast>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'ast>,
    role: &str,
    variants: &[&'variant str],
    ctx: &LintContext<'ast>,
    analysis: &mut CompositeWidgetAnalysis,
) -> Option<CompositeWidgetStateVariant<'variant>> {
    let state_variants = variants
        .iter()
        .filter_map(|variant| composite_widget_state_variant(variant))
        .collect::<Vec<_>>();
    if state_variants.len() != 1
        || variants.iter().any(|variant| {
            composite_widget_state_variant(variant).is_none()
                && !STABLE_STATE_CONTEXT_VARIANTS.contains(variant)
        })
    {
        return None;
    }
    let state_variant = state_variants[0];
    if !composite_widget_role_supports_state(role, state_variant.state_name) {
        return None;
    }
    let values = composite_widget_exhaustive_attribute_values(
        opening_node,
        opening_element,
        state_variant.state_attribute_name,
        ctx,
        analysis,
    )?;
    let has_active_value = values.iter().any(|value| {
        if state_variant.state_name == "current" {
            ARIA_CURRENT_ACTIVE_VALUES.contains(&value.as_str())
        } else {
            value == "true"
        }
    });
    let has_inactive_value = values.iter().any(|value| {
        if state_variant.state_name == "current" {
            !ARIA_CURRENT_ACTIVE_VALUES.contains(&value.as_str())
        } else {
            value != "true"
        }
    });
    let selector_can_change = values
        .iter()
        .any(|value| value == state_variant.selector_value)
        && values
            .iter()
            .any(|value| value != state_variant.selector_value);
    (has_active_value && has_inactive_value && selector_can_change).then_some(state_variant)
}

fn effective_state_paint_property<'ast, 'token>(
    opening_node: &AstNode<'ast>,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'ast>,
    role: &str,
    tokens: &[TailwindClassNameToken<'token>],
    ctx: &LintContext<'ast>,
    analysis: &mut CompositeWidgetAnalysis,
) -> Option<(TailwindPaintDeclaration<'token>, Vec<&'token str>)> {
    for token in tokens {
        let Some(_state_variant) = composite_widget_get_state_variant(
            opening_node,
            opening_element,
            role,
            &token.variants,
            ctx,
            analysis,
        ) else {
            continue;
        };
        let Some(state_declaration) = tailwind_paint_declaration(token.utility) else {
            continue;
        };
        if token.is_important {
            continue;
        }
        let effective_state = resolve_effective_tailwind_class_name_token(
            tokens,
            |utility| {
                tailwind_paint_declaration(utility).is_some_and(|declaration| {
                    declaration.property_name == state_declaration.property_name
                })
            },
            &token.variants,
        );
        if effective_state.is_ambiguous
            || effective_state.is_important
            || effective_state.utility != Some(token.utility)
        {
            continue;
        }
        let resting_state = composite_widget_resolve_resting_token(
            tokens,
            |utility| {
                tailwind_paint_declaration(utility).is_some_and(|declaration| {
                    declaration.property_name == state_declaration.property_name
                })
            },
            &token.variants,
        );
        if resting_state.is_ambiguous || resting_state.is_important {
            continue;
        }
        let Some(resting_declaration) = resting_state.utility.and_then(tailwind_paint_declaration)
        else {
            continue;
        };
        if canonical_colors_equivalent(resting_declaration.color, state_declaration.color) {
            continue;
        }
        return Some((state_declaration, token.variants.clone()));
    }
    None
}

fn composite_widget_resolve_resting_token<'a>(
    tokens: &[TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
    target_variant_scope: &[&str],
) -> EffectiveTailwindClassNameTokenResolution<'a> {
    let is_applicable = |token: &TailwindClassNameToken<'a>| {
        !token
            .variants
            .iter()
            .any(|variant| composite_widget_state_variant(variant).is_some())
            && predicate(token.utility)
            && does_tailwind_variant_scope_cover(&token.variants, target_variant_scope)
    };
    let has_important_token = tokens
        .iter()
        .any(|token| is_applicable(token) && token.is_important);
    let most_specific_scope_length = tokens
        .iter()
        .filter(|token| is_applicable(token) && (!has_important_token || token.is_important))
        .map(|token| token.variants.len())
        .max();
    let mut utility = None;
    for token in tokens {
        if !is_applicable(token)
            || has_important_token && !token.is_important
            || Some(token.variants.len()) != most_specific_scope_length
        {
            continue;
        }
        if utility.is_some_and(|current| current != token.utility) {
            return EffectiveTailwindClassNameTokenResolution {
                is_ambiguous: true,
                is_important: false,
                utility: None,
            };
        }
        utility = Some(token.utility);
    }
    EffectiveTailwindClassNameTokenResolution {
        is_ambiguous: false,
        is_important: utility.is_some() && has_important_token,
        utility,
    }
}

fn tailwind_paint_declaration(utility: &str) -> Option<TailwindPaintDeclaration<'_>> {
    if let Some(contents) = utility
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        let (property_name, value) = contents.split_once(':')?;
        if !PAINT_PROPERTY_NAMES.contains(&property_name) {
            return None;
        }
        return Some(TailwindPaintDeclaration {
            color: canonical_paint_color(value, None)?,
            property_name,
        });
    }
    let (utility_without_modifier, modifier) =
        composite_widget_split_tailwind_opacity_modifier(utility);
    let (prefix, raw_value) = utility_without_modifier.split_once('-')?;
    let property_name = match prefix {
        "bg" => "background-color",
        "text" => "color",
        "border" => "border-color",
        _ => return None,
    };
    if !raw_value.starts_with('[') || !raw_value.ends_with(']') {
        return None;
    }
    Some(TailwindPaintDeclaration {
        color: canonical_paint_color(raw_value, modifier)?,
        property_name,
    })
}

fn composite_widget_split_tailwind_opacity_modifier(utility: &str) -> (&str, Option<&str>) {
    let mut bracket_depth = 0_u32;
    for (index, character) in utility.char_indices() {
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '/' if bracket_depth == 0 => return (&utility[..index], Some(&utility[index + 1..])),
            _ => {}
        }
    }
    (utility, None)
}

fn canonical_paint_color(
    raw_value: &str,
    opacity_modifier: Option<&str>,
) -> Option<CanonicalPaintColor> {
    let opacity = composite_widget_opacity(opacity_modifier)?;
    let normalized = normalize_tailwind_arbitrary_utility_value(raw_value).to_ascii_lowercase();
    let value = normalized.as_str();
    if value == "transparent" {
        return Some(CanonicalPaintColor {
            alpha: 0.0,
            blue: 0.0,
            green: 0.0,
            red: 0.0,
        });
    }
    if value == "white" {
        return Some(CanonicalPaintColor {
            alpha: opacity,
            blue: 255.0,
            green: 255.0,
            red: 255.0,
        });
    }
    if value == "black" {
        return Some(CanonicalPaintColor {
            alpha: opacity,
            blue: 0.0,
            green: 0.0,
            red: 0.0,
        });
    }
    let css_color = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .map(|value| value.strip_prefix("color:").unwrap_or(value))
        .unwrap_or(value);
    if !css_color.starts_with('#') && !css_color.starts_with("rgb") {
        return None;
    }
    let rgb = parse_color_to_rgb(css_color)?;
    if rgb.red > 255.0 || rgb.green > 255.0 || rgb.blue > 255.0 {
        return None;
    }
    Some(CanonicalPaintColor {
        alpha: composite_widget_color_alpha(css_color)? * opacity,
        blue: rgb.blue,
        green: rgb.green,
        red: rgb.red,
    })
}

fn composite_widget_opacity(modifier: Option<&str>) -> Option<f64> {
    let Some(modifier) = modifier else {
        return Some(1.0);
    };
    let raw = modifier
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(modifier);
    let is_percent = raw.ends_with('%');
    let value = raw.trim_end_matches('%').parse::<f64>().ok()?;
    let normalized = if is_percent || !modifier.starts_with('[') {
        value / 100.0
    } else {
        value
    };
    (0.0..=1.0).contains(&normalized).then_some(normalized)
}

fn composite_widget_color_alpha(value: &str) -> Option<f64> {
    if let Some(hex) = value.strip_prefix('#') {
        return match hex.len() {
            3 | 6 => Some(1.0),
            4 => Some(u8::from_str_radix(&hex[3..4], 16).ok()? as f64 / 15.0),
            8 => Some(u8::from_str_radix(&hex[6..8], 16).ok()? as f64 / 255.0),
            _ => None,
        };
    }
    let body = value
        .split_once('(')?
        .1
        .strip_suffix(')')?
        .replace('_', " ");
    if let Some((_, alpha)) = body.rsplit_once('/') {
        return composite_widget_parse_alpha(alpha.trim());
    }
    let parts = body.split(',').map(str::trim).collect::<Vec<_>>();
    if parts.len() == 4 {
        return composite_widget_parse_alpha(parts[3]);
    }
    Some(1.0)
}

fn composite_widget_parse_alpha(value: &str) -> Option<f64> {
    let is_percent = value.ends_with('%');
    let raw = value.trim_end_matches('%').parse::<f64>().ok()?;
    let normalized = if is_percent { raw / 100.0 } else { raw };
    (0.0..=1.0).contains(&normalized).then_some(normalized)
}

fn canonical_colors_equivalent(left: CanonicalPaintColor, right: CanonicalPaintColor) -> bool {
    left.alpha == 0.0 && right.alpha == 0.0
        || left.red == right.red
            && left.green == right.green
            && left.blue == right.blue
            && left.alpha == right.alpha
}

fn has_transitioned_paint_property<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    tokens: &[TailwindClassNameToken<'_>],
    target_variants: &[&str],
    target_property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
    let style_object = match style_attribute {
        Some(attribute) => match get_inline_style_object_expression_with_aliases(attribute, ctx) {
            Some(object) => Some(object),
            None => return false,
        },
        None => None,
    };
    let paint_style_names: &[&str] = match target_property_name {
        "background-color" => &["background", "backgroundColor"],
        "border-color" => &["border", "borderColor"],
        _ => &["color"],
    };
    if style_object.is_some_and(|object| {
        composite_widget_effective_style_property(object, paint_style_names).is_some()
    }) {
        return false;
    }
    let Some((default_duration, property_names)) = composite_widget_tailwind_transition_defaults(
        tokens,
        target_variants,
        target_property_name,
    ) else {
        return false;
    };
    let transition_property = style_object
        .and_then(|object| composite_widget_effective_style_string(object, "transitionProperty"));
    let transition_duration = style_object
        .and_then(|object| composite_widget_effective_style_string(object, "transitionDuration"));
    let transition_shorthand = style_object
        .and_then(|object| composite_widget_effective_style_string(object, "transition"));
    let (effective_properties, effective_durations) = if let Some(shorthand) = transition_shorthand
    {
        let Some(values) = composite_widget_parse_transition_shorthand(shorthand) else {
            return false;
        };
        (
            values
                .iter()
                .map(|value| value.0.clone())
                .collect::<Vec<_>>(),
            values.iter().map(|value| value.1).collect::<Vec<_>>(),
        )
    } else {
        let properties = match transition_property {
            Some(value) => {
                let Some(properties) = composite_widget_parse_transition_properties(value) else {
                    return false;
                };
                properties
            }
            None => property_names,
        };
        let durations = match transition_duration {
            Some(value) => {
                let Some(durations) = composite_widget_parse_transition_durations(value) else {
                    return false;
                };
                durations
            }
            None => {
                vec![if default_duration { 1.0 } else { 0.0 }; properties.len().max(1)]
            }
        };
        (properties, durations)
    };
    effective_properties
        .iter()
        .enumerate()
        .any(|(index, property)| {
            property == target_property_name
                && effective_durations
                    .get(index % effective_durations.len())
                    .is_some_and(|duration| *duration > 0.0)
        })
}

fn composite_widget_tailwind_transition_defaults(
    tokens: &[TailwindClassNameToken<'_>],
    target_variants: &[&str],
    target_property_name: &str,
) -> Option<(bool, Vec<String>)> {
    let property_tokens = composite_widget_highest_priority_tokens(tokens, |token| {
        does_tailwind_variant_scope_cover(&token.variants, target_variants)
            && composite_widget_transition_properties(token.utility).is_some()
    });
    if property_tokens.iter().any(|token| token.is_important) {
        return None;
    }
    let property_lists = property_tokens
        .iter()
        .map(|token| composite_widget_transition_properties(token.utility))
        .collect::<Option<Vec<_>>>()?;
    if property_lists
        .iter()
        .skip(1)
        .any(|properties| Some(properties) != property_lists.first())
    {
        return None;
    }
    let property_names = property_lists
        .first()
        .cloned()
        .unwrap_or_else(|| vec!["all".to_string()]);
    let relevant_duration_tokens = tokens.iter().filter(|token| {
        does_tailwind_variant_scope_cover(&token.variants, target_variants)
            && composite_widget_is_transition_duration_setter(token.utility)
    });
    if relevant_duration_tokens
        .clone()
        .any(|token| token.is_important)
    {
        return None;
    }
    let mut target_property_names = property_names
        .iter()
        .filter(|property| PAINT_PROPERTY_NAMES.contains(&property.as_str()))
        .map(String::as_str)
        .collect::<FxHashSet<_>>();
    if target_property_names.is_empty() {
        target_property_names.insert("all");
    }
    let duration_state = composite_widget_resolve_transition_duration_state(
        tokens,
        target_variants,
        &target_property_names,
    );
    let default_duration = if let Some(duration_state) = duration_state {
        duration_state
    } else if relevant_duration_tokens.count() > 0 {
        return None;
    } else {
        property_tokens.iter().any(|token| {
            matches!(token.utility, "transition" | "transition-colors")
                || token.utility.starts_with("transition-[") && token.utility.ends_with(']')
        })
    };
    if !property_names
        .iter()
        .any(|property| property == target_property_name)
        && property_names != ["all"]
    {
        return Some((default_duration, property_names));
    }
    Some((default_duration, property_names))
}

fn composite_widget_resolve_transition_duration_state<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    target_variants: &[&str],
    target_property_names: &FxHashSet<&str>,
) -> Option<bool> {
    let duration_tokens = composite_widget_highest_priority_tokens(tokens, |token| {
        does_tailwind_variant_scope_cover(&token.variants, target_variants)
            && composite_widget_transition_duration_effect(token.utility, target_property_names)
                .is_some()
    });
    let effects = duration_tokens
        .iter()
        .filter_map(|token| {
            composite_widget_transition_duration_effect(token.utility, target_property_names)
        })
        .collect::<Vec<_>>();
    let has_explicit = effects.iter().any(|effect| effect.is_explicit);
    let effective_effects = effects
        .iter()
        .filter(|effect| !has_explicit || effect.is_explicit);
    let property_names =
        composite_widget_effective_transition_property_names(tokens, target_variants);
    let states = effective_effects
        .map(|effect| {
            composite_widget_duration_effect_state(
                effect,
                property_names.as_deref(),
                target_property_names,
            )
        })
        .collect::<FxHashSet<_>>();
    if states.len() != 1 {
        return None;
    }
    states.into_iter().next().flatten()
}

fn composite_widget_effective_transition_property_names(
    tokens: &[TailwindClassNameToken<'_>],
    target_variants: &[&str],
) -> Option<Vec<String>> {
    let property_tokens = composite_widget_highest_priority_tokens(tokens, |token| {
        does_tailwind_variant_scope_cover(&token.variants, target_variants)
            && composite_widget_transition_properties(token.utility).is_some()
    });
    if property_tokens.is_empty() {
        return Some(vec!["all".to_string()]);
    }
    let property_names = composite_widget_transition_properties(property_tokens[0].utility)?;
    property_tokens
        .iter()
        .skip(1)
        .all(|token| {
            composite_widget_transition_properties(token.utility).as_ref() == Some(&property_names)
        })
        .then_some(property_names)
}

fn composite_widget_duration_effect_state(
    effect: &CompositeWidgetDurationEffect,
    property_names: Option<&[String]>,
    target_property_names: &FxHashSet<&str>,
) -> Option<bool> {
    let states = effect.states.as_ref()?;
    let first = *states.first()?;
    if states.iter().all(|state| *state == first) {
        return Some(first);
    }
    if !effect.is_explicit {
        return None;
    }
    let property_names = property_names?;
    let paired_states = property_names
        .iter()
        .enumerate()
        .filter(|(_, property)| {
            property.as_str() == "all" || target_property_names.contains(property.as_str())
        })
        .map(|(index, _)| states[index % states.len()])
        .collect::<FxHashSet<_>>();
    (paired_states.len() == 1)
        .then(|| paired_states.into_iter().next())
        .flatten()
}

fn composite_widget_highest_priority_tokens<'a, 'b>(
    tokens: &'b [TailwindClassNameToken<'a>],
    predicate: impl Fn(&TailwindClassNameToken<'a>) -> bool,
) -> Vec<&'b TailwindClassNameToken<'a>> {
    let applicable = tokens
        .iter()
        .filter(|token| predicate(token))
        .collect::<Vec<_>>();
    let has_important = applicable.iter().any(|token| token.is_important);
    let maximum_scope = applicable
        .iter()
        .filter(|token| !has_important || token.is_important)
        .map(|token| token.variants.len())
        .max();
    applicable
        .into_iter()
        .filter(|token| {
            (!has_important || token.is_important) && Some(token.variants.len()) == maximum_scope
        })
        .collect()
}

fn composite_widget_transition_properties(utility: &str) -> Option<Vec<String>> {
    match utility {
        "transition-none" => Some(vec!["none".to_string()]),
        "transition" => Some(
            TRANSITION_DEFAULT_PROPERTY_NAMES
                .iter()
                .map(ToString::to_string)
                .collect(),
        ),
        "transition-all" => Some(vec!["all".to_string()]),
        "transition-colors" => Some(
            TRANSITION_COLORS_PROPERTY_NAMES
                .iter()
                .map(ToString::to_string)
                .collect(),
        ),
        "transition-opacity" => Some(vec!["opacity".to_string()]),
        "transition-shadow" => Some(vec!["box-shadow".to_string()]),
        "transition-transform" => Some(vec!["transform".to_string()]),
        _ => {
            if let Some(value) = utility
                .strip_prefix("transition-[")
                .or_else(|| utility.strip_prefix("[transition-property:"))
                .and_then(|value| value.strip_suffix(']'))
            {
                return Some(
                    normalize_tailwind_arbitrary_utility_value(value)
                        .split(',')
                        .map(|property| property.trim().to_ascii_lowercase())
                        .collect(),
                );
            }
            let value = utility.strip_prefix("[transition:")?.strip_suffix(']')?;
            Some(
                composite_widget_parse_transition_shorthand(
                    &normalize_tailwind_arbitrary_utility_value(value),
                )?
                .into_iter()
                .map(|transition| transition.0)
                .collect(),
            )
        }
    }
}

fn composite_widget_is_transition_duration_setter(utility: &str) -> bool {
    utility.starts_with("duration-")
        || utility.starts_with("[transition-duration:")
        || utility.starts_with("[transition:")
}

fn composite_widget_transition_duration_effect(
    utility: &str,
    target_property_names: &FxHashSet<&str>,
) -> Option<CompositeWidgetDurationEffect> {
    if let Some(raw_duration) = utility.strip_prefix("duration-") {
        let states = if let Some(value) = raw_duration
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            composite_widget_duration_states(&normalize_tailwind_arbitrary_utility_value(value))
        } else {
            raw_duration
                .parse::<f64>()
                .ok()
                .map(|duration| vec![duration > 0.0])
        };
        return Some(CompositeWidgetDurationEffect {
            is_explicit: true,
            states,
        });
    }
    if let Some(value) = utility
        .strip_prefix("[transition-duration:")
        .and_then(|value| value.strip_suffix(']'))
    {
        return Some(CompositeWidgetDurationEffect {
            is_explicit: true,
            states: composite_widget_duration_states(&normalize_tailwind_arbitrary_utility_value(
                value,
            )),
        });
    }
    if let Some(value) = utility
        .strip_prefix("[transition:")
        .and_then(|value| value.strip_suffix(']'))
    {
        let transitions = composite_widget_parse_transition_shorthand(
            &normalize_tailwind_arbitrary_utility_value(value),
        );
        let states = transitions.as_ref().map(|transitions| {
            transitions
                .iter()
                .filter(|transition| {
                    transition.0 == "all" || target_property_names.contains(transition.0.as_str())
                })
                .map(|transition| transition.1 > 0.0)
                .collect::<Vec<_>>()
        });
        return Some(CompositeWidgetDurationEffect {
            is_explicit: false,
            states: states.filter(|states| !states.is_empty()),
        });
    }
    let property_names = composite_widget_transition_properties(utility)?;
    (target_property_names.contains("all") && property_names.iter().any(|name| name == "all"))
        .then_some(CompositeWidgetDurationEffect {
            is_explicit: false,
            states: Some(vec![true]),
        })
}

fn composite_widget_duration_states(value: &str) -> Option<Vec<bool>> {
    let states = value
        .split(',')
        .map(|duration| {
            let duration = duration.trim();
            let number = duration
                .strip_suffix("ms")
                .or_else(|| duration.strip_suffix('s'))?
                .parse::<f64>()
                .ok()?;
            (number >= 0.0).then_some(number > 0.0)
        })
        .collect::<Option<Vec<_>>>()?;
    (!states.is_empty()).then_some(states)
}

fn composite_widget_effective_style_property<'a>(
    object: &'a ObjectExpression<'a>,
    names: &[&str],
) -> Option<&'a oxc_ast::ast::ObjectProperty<'a>> {
    let mut effective = Vec::new();
    composite_widget_collect_effective_style_properties(
        &object.properties,
        &mut effective,
        &mut FxHashMap::default(),
    )?;
    effective
        .into_iter()
        .rev()
        .find(|(_, property)| {
            property
                .key
                .static_name()
                .is_some_and(|name| names.iter().any(|candidate| *candidate == name.as_ref()))
        })
        .map(|(_, property)| property)
}

fn composite_widget_collect_effective_style_properties<'a>(
    properties: &'a [ObjectPropertyKind<'a>],
    effective: &mut Vec<(String, &'a ObjectProperty<'a>)>,
    property_indices: &mut FxHashMap<String, usize>,
) -> Option<()> {
    for property in properties {
        let property = match property {
            ObjectPropertyKind::SpreadProperty(spread) => {
                let Expression::ObjectExpression(object) = spread.argument.get_inner_expression()
                else {
                    return None;
                };
                composite_widget_collect_effective_style_properties(
                    &object.properties,
                    effective,
                    property_indices,
                )?;
                continue;
            }
            ObjectPropertyKind::ObjectProperty(property) => property,
        };
        let name = property.key.static_name()?.to_string();
        if let Some(index) = property_indices.get(&name) {
            effective[*index].1 = property;
        } else {
            property_indices.insert(name.clone(), effective.len());
            effective.push((name, property));
        }
    }
    Some(())
}

fn composite_widget_effective_style_string<'a>(
    object: &'a ObjectExpression<'a>,
    target_name: &str,
) -> Option<&'a str> {
    let property = composite_widget_effective_style_property(object, &[target_name])?;
    match property.value.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            Some(template.quasis[0].value.raw.as_str())
        }
        _ => None,
    }
}

fn composite_widget_parse_transition_properties(value: &str) -> Option<Vec<String>> {
    let properties = value
        .split(',')
        .map(|property| property.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    (!properties.is_empty() && !properties.iter().any(String::is_empty)).then_some(properties)
}

fn composite_widget_parse_transition_durations(value: &str) -> Option<Vec<f64>> {
    let mut durations = Vec::new();
    for raw in value.split(',') {
        let raw = raw.trim();
        let (number, multiplier) = if let Some(number) = raw.strip_suffix("ms") {
            (number, 1.0)
        } else if let Some(number) = raw.strip_suffix('s') {
            (number, 1000.0)
        } else {
            return None;
        };
        durations.push(number.parse::<f64>().ok()? * multiplier);
    }
    (!durations.is_empty()).then_some(durations)
}

fn composite_widget_parse_transition_shorthand(value: &str) -> Option<Vec<(String, f64)>> {
    let mut transitions = Vec::new();
    for segment in value.split(',') {
        let mut property = "all".to_string();
        let mut duration = 0.0;
        let mut property_count = 0;
        let mut time_count = 0;
        for token in segment.split_whitespace() {
            if token.ends_with("ms") || token.ends_with('s') {
                time_count += 1;
                if time_count == 1 {
                    duration = composite_widget_parse_transition_durations(token)?[0];
                }
                continue;
            }
            if matches!(
                token,
                "ease"
                    | "ease-in"
                    | "ease-in-out"
                    | "ease-out"
                    | "linear"
                    | "step-end"
                    | "step-start"
            ) || token.starts_with("cubic-bezier(")
                || token.starts_with("steps(")
            {
                continue;
            }
            property_count += 1;
            if property_count > 1 {
                return None;
            }
            property = token.to_ascii_lowercase();
        }
        transitions.push((property, duration));
    }
    (!transitions.is_empty()).then_some(transitions)
}

fn composite_widget_static_boolean(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            composite_widget_static_boolean(&unary.argument, ctx, visited_symbols)
                .map(|value| !value)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let initializer = composite_widget_const_initializer(symbol_id, ctx)?;
            visited_symbols.push(symbol_id);
            let result = composite_widget_static_boolean(initializer, ctx, visited_symbols);
            visited_symbols.pop();
            result
        }
        _ => None,
    }
}

fn composite_widget_is_statically_unreachable(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut child = node;
    loop {
        let parent = ctx.nodes().parent_node(child.id());
        let child_span = child.span();
        match parent.kind() {
            AstKind::ConditionalExpression(conditional) => {
                if let Some(test) =
                    composite_widget_static_boolean(&conditional.test, ctx, &mut Vec::new())
                    && ((!test && conditional.consequent.span() == child_span)
                        || (test && conditional.alternate.span() == child_span))
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                if let Some(left) =
                    composite_widget_static_boolean(&logical.left, ctx, &mut Vec::new())
                    && ((logical.operator == LogicalOperator::And && !left)
                        || (logical.operator == LogicalOperator::Or && left))
                {
                    return true;
                }
            }
            AstKind::IfStatement(statement) => {
                if let Some(test) =
                    composite_widget_static_boolean(&statement.test, ctx, &mut Vec::new())
                    && ((!test && statement.consequent.span() == child_span)
                        || (test
                            && statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| alternate.span() == child_span)))
                {
                    return true;
                }
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
        child = parent;
    }
}

fn composite_widget_is_unconditional_from_entry<'a>(
    node: &AstNode<'a>,
    analysis: &mut CompositeWidgetAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let owner = crate::ast_util::get_enclosing_function(node, ctx)
        .or_else(|| ctx.nodes().iter().next())
        .expect("program node");
    let entry_block = ctx.nodes().cfg_id(owner.id());
    let target_block = ctx.nodes().cfg_id(node.id());
    if let Some(result) = analysis
        .unconditional_by_cfg_pair
        .get(&(entry_block, target_block))
    {
        return *result;
    }
    let reachable = composite_widget_reachable_cfg_blocks(entry_block, None, ctx);
    let result = reachable.contains(&target_block)
        && !composite_widget_reachable_cfg_blocks(entry_block, Some(target_block), ctx)
            .into_iter()
            .any(|block_id| {
                ctx.cfg()
                    .basic_block(block_id)
                    .instructions()
                    .iter()
                    .any(|instruction| {
                        matches!(
                            instruction.kind,
                            oxc_cfg::InstructionKind::ImplicitReturn
                                | oxc_cfg::InstructionKind::Return(_)
                        )
                    })
            });
    analysis
        .unconditional_by_cfg_pair
        .insert((entry_block, target_block), result);
    result
}

fn composite_widget_reachable_cfg_blocks(
    entry_block: oxc_cfg::BlockNodeId,
    excluded_block: Option<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_cfg::BlockNodeId> {
    let mut visited = FxHashSet::default();
    let mut pending = Vec::new();
    if Some(entry_block) != excluded_block {
        pending.push(entry_block);
    }
    while let Some(block_id) = pending.pop() {
        if !visited.insert(block_id) {
            continue;
        }
        for edge in ctx
            .cfg()
            .graph()
            .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
        {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if Some(target) != excluded_block {
                pending.push(target);
            }
        }
    }
    visited
}
