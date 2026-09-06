use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This control stays visible at a responsive breakpoint after all of its accessible-name content is hidden. Keep a screen-reader-readable name available at every breakpoint.";
const BREAKPOINT_COUNT: usize = 6;

#[derive(Debug, Default, Clone)]
pub struct NoResponsiveHiddenAccessibleName;

#[derive(Clone)]
struct ResponsiveVisibility {
    display: Vec<bool>,
    visibility: Vec<bool>,
}

struct ElementVisibility {
    display: Vec<bool>,
    visibility_overrides: Vec<Option<bool>>,
    has_generated_content: bool,
    is_inert: bool,
}

struct AccessibleNameEvidence {
    availability: Vec<bool>,
    did_find_contributor: bool,
    is_unknown: bool,
}

declare_oxc_lint!(
    /// Warns when responsive styles hide all of a visible control's accessible name.
    NoResponsiveHiddenAccessibleName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Responsive styles hide a control's accessible name.",
);

impl Rule for NoResponsiveHiddenAccessibleName {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "tailwind") {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            check_responsive_accessible_name(node, element, ctx);
        }
    }
}

fn check_responsive_accessible_name<'a>(
    node: &AstNode<'a>,
    element: &JSXElement<'a>,
    ctx: &LintContext<'a>,
) {
    let opening_element = &element.opening_element;
    if has_any_jsx_spread_attribute(opening_element)
        || is_inside_opaque_composition_boundary(node, ctx)
    {
        return;
    }
    let Some(tag_name) = exact_intrinsic_tag_name(opening_element, ctx) else {
        return;
    };
    if !has_proven_interactive_semantics(opening_element, &tag_name, ctx)
        || has_potential_non_content_name(
            opening_element,
            &["aria-label", "aria-labelledby", "title"],
            ctx,
        )
        || has_potential_non_content_name(opening_element, &["id"], ctx)
        || get_authoritative_jsx_attribute(opening_element, "children", false).is_some()
        || get_authoritative_jsx_attribute(opening_element, "dangerouslySetInnerHTML", false)
            .is_some()
    {
        return;
    }
    let Some((control_visibility, has_generated_content)) =
        control_visibility(node, element, &tag_name, ctx)
    else {
        return;
    };
    if has_generated_content {
        return;
    }
    let effective_control_visibility = effective_visibility(&control_visibility);
    let mut evidence = AccessibleNameEvidence {
        availability: vec![false; BREAKPOINT_COUNT],
        did_find_contributor: false,
        is_unknown: false,
    };
    collect_accessible_name_evidence(&element.children, &control_visibility, &mut evidence, ctx);
    if evidence.is_unknown || !evidence.did_find_contributor {
        return;
    }
    let has_named_visible_breakpoint = evidence.availability.iter().any(|available| *available);
    let has_visible_unnamed_breakpoint = effective_control_visibility
        .iter()
        .zip(&evidence.availability)
        .any(|(is_visible, is_named)| *is_visible && !*is_named);
    if has_named_visible_breakpoint && has_visible_unnamed_breakpoint {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn exact_intrinsic_tag_name<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if !is_proven_intrinsic_jsx_element(opening_element, ctx) {
        return None;
    }
    let tag_name = resolve_jsx_element_type_name(opening_element, ctx).into_owned();
    (tag_name == tag_name.to_ascii_lowercase()).then_some(tag_name)
}

fn is_inside_opaque_composition_boundary(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return true,
            AstKind::JSXElement(element)
                if exact_intrinsic_tag_name(&element.opening_element, ctx).is_none() =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn has_proven_interactive_semantics(
    opening_element: &JSXOpeningElement<'_>,
    tag_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if !matches!(tag_name, "a" | "button")
        || get_authoritative_jsx_attribute(opening_element, "role", false).is_some()
    {
        return false;
    }
    if tag_name == "button" {
        return resolve_boolean_attribute(opening_element, "disabled", true) == Some(false);
    }
    resolve_non_empty_text_attribute(opening_element, "href", ctx) == Some(true)
}

fn resolve_non_empty_text_attribute(
    opening_element: &JSXOpeningElement<'_>,
    name: &str,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, name, false) else {
        return Some(false);
    };
    let values = exhaustive_static_string_attribute_values(attribute, ctx)?;
    Some(values.iter().any(|value| !value.trim().is_empty()))
}

fn has_potential_non_content_name(
    opening_element: &JSXOpeningElement<'_>,
    names: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    names
        .iter()
        .any(|name| resolve_non_empty_text_attribute(opening_element, name, ctx) != Some(false))
}

fn resolve_boolean_attribute(
    opening_element: &JSXOpeningElement<'_>,
    name: &str,
    is_html_boolean: bool,
) -> Option<bool> {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, name, false) else {
        return Some(false);
    };
    let Some(value) = attribute.value.as_ref() else {
        return Some(true);
    };
    match value {
        JSXAttributeValue::StringLiteral(value) => {
            if is_html_boolean {
                Some(true)
            } else {
                match value.value.as_str() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                }
            }
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::Identifier(identifier) if identifier.name == "undefined" => Some(false),
            JSXExpression::NullLiteral(_) => Some(false),
            JSXExpression::BooleanLiteral(value) => Some(value.value),
            JSXExpression::StringLiteral(value) if is_html_boolean => Some(true),
            JSXExpression::StringLiteral(value) => match value.value.as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }
}

fn resolve_subtree_exclusion(opening_element: &JSXOpeningElement<'_>) -> Option<bool> {
    if has_any_jsx_spread_attribute(opening_element) {
        return None;
    }
    let hidden = resolve_boolean_attribute(opening_element, "hidden", true)?;
    let aria_hidden = resolve_boolean_attribute(opening_element, "aria-hidden", false)?;
    let inert = resolve_boolean_attribute(opening_element, "inert", true)?;
    Some(hidden || aria_hidden || inert)
}

fn resolve_element_visibility(
    opening_element: &JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> Option<ElementVisibility> {
    if has_any_jsx_spread_attribute(opening_element)
        || get_authoritative_jsx_attribute(opening_element, "class", false).is_some()
        || get_authoritative_jsx_attribute(opening_element, "style", false).is_some()
    {
        return None;
    }
    let hidden = resolve_boolean_attribute(opening_element, "hidden", true)?;
    let aria_hidden = resolve_boolean_attribute(opening_element, "aria-hidden", false)?;
    let inert = resolve_boolean_attribute(opening_element, "inert", true)?;
    let class_names = if let Some(attribute) =
        get_authoritative_jsx_attribute(opening_element, "className", false)
    {
        exhaustive_static_string_attribute_values(attribute, ctx)?
    } else {
        vec![String::new()]
    };
    let mut candidates = class_names
        .iter()
        .map(|class_name| resolve_tailwind_visibility(class_name))
        .collect::<Option<Vec<_>>>()?;
    let first = candidates.pop()?;
    if candidates.iter().any(|candidate| {
        candidate.display != first.display
            || candidate.visibility_overrides != first.visibility_overrides
            || candidate.has_generated_content != first.has_generated_content
    }) {
        return None;
    }
    Some(ElementVisibility {
        display: if hidden || aria_hidden {
            vec![false; BREAKPOINT_COUNT]
        } else {
            first.display
        },
        visibility_overrides: first.visibility_overrides,
        has_generated_content: first.has_generated_content,
        is_inert: inert,
    })
}

fn resolve_tailwind_visibility(class_name: &str) -> Option<ElementVisibility> {
    let tokens = tailwind_class_name_tokens(class_name);
    if tokens.iter().any(|token| {
        let utility = token.utility.to_ascii_lowercase();
        utility.starts_with("[display:") || utility.starts_with("[visibility:")
    }) {
        return None;
    }
    let has_generated_content = tokens.iter().any(|token| {
        let utility = token.utility.to_ascii_lowercase();
        utility.starts_with("content-") || utility.starts_with("[content:")
    });
    let mut display_tokens = Vec::new();
    let mut visibility_tokens = Vec::new();
    let mut visibility_overrides = vec![false; BREAKPOINT_COUNT];
    for token in &tokens {
        if matches!(token.utility, "collapse" | "invisible" | "visible") {
            let applicability = responsive_variant_applicability(&token.variants)?;
            for (has_override, applies) in visibility_overrides.iter_mut().zip(applicability) {
                *has_override |= applies;
            }
            visibility_tokens.push(token.raw_token);
        } else {
            display_tokens.push(token.raw_token);
        }
    }
    let display = get_tailwind_visibility_at_breakpoints(&display_tokens.join(" "))?;
    let visibility = get_tailwind_visibility_at_breakpoints(&visibility_tokens.join(" "))?;
    Some(ElementVisibility {
        display,
        visibility_overrides: visibility
            .into_iter()
            .zip(visibility_overrides)
            .map(|(is_visible, has_override)| has_override.then_some(is_visible))
            .collect(),
        has_generated_content,
        is_inert: false,
    })
}

fn responsive_variant_applicability(variants: &[&str]) -> Option<Vec<bool>> {
    const BREAKPOINTS: [&str; BREAKPOINT_COUNT] = ["", "sm", "md", "lg", "xl", "2xl"];
    let mut minimum = 0;
    let mut maximum = BREAKPOINT_COUNT;
    for variant in variants {
        if let Some(index) = BREAKPOINTS
            .iter()
            .position(|candidate| candidate == variant)
            && index > 0
        {
            minimum = minimum.max(index);
            continue;
        }
        if let Some(maximum_name) = variant.strip_prefix("max-")
            && let Some(index) = BREAKPOINTS
                .iter()
                .position(|candidate| *candidate == maximum_name)
            && index > 0
        {
            maximum = maximum.min(index);
            continue;
        }
        return None;
    }
    Some(
        (0..BREAKPOINT_COUNT)
            .map(|index| index >= minimum && index < maximum)
            .collect(),
    )
}

fn combine_visibility(
    inherited: &ResponsiveVisibility,
    own: &ElementVisibility,
) -> ResponsiveVisibility {
    ResponsiveVisibility {
        display: inherited
            .display
            .iter()
            .zip(&own.display)
            .map(|(ancestor, current)| *ancestor && *current)
            .collect(),
        visibility: inherited
            .visibility
            .iter()
            .zip(&own.visibility_overrides)
            .map(|(ancestor, current)| current.unwrap_or(*ancestor))
            .collect(),
    }
}

fn effective_visibility(visibility: &ResponsiveVisibility) -> Vec<bool> {
    visibility
        .display
        .iter()
        .zip(&visibility.visibility)
        .map(|(display, visible)| *display && *visible)
        .collect()
}

fn control_visibility<'a>(
    node: &AstNode<'a>,
    control: &JSXElement<'a>,
    control_tag: &str,
    ctx: &LintContext<'a>,
) -> Option<(ResponsiveVisibility, bool)> {
    let mut elements = vec![control];
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXElement(element) => elements.push(element),
            AstKind::JSXExpressionContainer(_)
            | AstKind::LogicalExpression(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::ArrayExpression(_)
            | AstKind::JSXFragment(_)
            | AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::ChainExpression(_) => {}
            AstKind::ReturnStatement(_) => break,
            AstKind::ArrowFunctionExpression(_) => {
                if !matches!(
                    ctx.nodes().parent_kind(ancestor.id()),
                    AstKind::VariableDeclarator(_) | AstKind::ExportDefaultDeclaration(_)
                ) {
                    return None;
                }
                break;
            }
            _ => return None,
        }
    }
    let mut combined = ResponsiveVisibility {
        display: vec![true; BREAKPOINT_COUNT],
        visibility: vec![true; BREAKPOINT_COUNT],
    };
    let mut control_has_generated_content = false;
    for element in elements.into_iter().rev() {
        let opening_element = &element.opening_element;
        let tag_name = exact_intrinsic_tag_name(opening_element, ctx)?;
        let is_control = std::ptr::eq(element, control);
        if !is_control && tag_name == "label" {
            return None;
        }
        if control_tag == "button"
            && !is_control
            && tag_name == "fieldset"
            && resolve_boolean_attribute(opening_element, "disabled", true) != Some(false)
        {
            return None;
        }
        let own_visibility = resolve_element_visibility(opening_element, ctx)?;
        if own_visibility.is_inert {
            return None;
        }
        combined = combine_visibility(&combined, &own_visibility);
        if is_control {
            control_has_generated_content = own_visibility.has_generated_content;
        }
    }
    Some((combined, control_has_generated_content))
}

fn collect_accessible_name_evidence<'a>(
    children: &[JSXChild<'a>],
    inherited_visibility: &ResponsiveVisibility,
    evidence: &mut AccessibleNameEvidence,
    ctx: &LintContext<'a>,
) {
    for child in children {
        if evidence.is_unknown {
            return;
        }
        match child {
            JSXChild::Text(text) => {
                if !text.value.trim().is_empty() {
                    record_text_contributor(inherited_visibility, evidence);
                }
            }
            JSXChild::Fragment(fragment) => collect_accessible_name_evidence(
                &fragment.children,
                inherited_visibility,
                evidence,
                ctx,
            ),
            JSXChild::Element(element) => {
                collect_element_name_evidence(element, inherited_visibility, evidence, ctx)
            }
            JSXChild::ExpressionContainer(container) => collect_expression_name_evidence(
                &container.expression,
                inherited_visibility,
                evidence,
                ctx,
            ),
            JSXChild::Spread(_) => evidence.is_unknown = true,
        }
    }
}

fn collect_expression_name_evidence<'a>(
    expression: &JSXExpression<'a>,
    inherited_visibility: &ResponsiveVisibility,
    evidence: &mut AccessibleNameEvidence,
    ctx: &LintContext<'a>,
) {
    match expression {
        JSXExpression::EmptyExpression(_)
        | JSXExpression::NullLiteral(_)
        | JSXExpression::BooleanLiteral(_) => {}
        JSXExpression::Identifier(identifier) if identifier.name == "undefined" => {}
        JSXExpression::StringLiteral(value) => {
            if !value.value.trim().is_empty() {
                record_text_contributor(inherited_visibility, evidence);
            }
        }
        JSXExpression::NumericLiteral(_) => record_text_contributor(inherited_visibility, evidence),
        JSXExpression::JSXElement(element) => {
            collect_element_name_evidence(element, inherited_visibility, evidence, ctx)
        }
        JSXExpression::JSXFragment(fragment) => collect_accessible_name_evidence(
            &fragment.children,
            inherited_visibility,
            evidence,
            ctx,
        ),
        _ => {
            let Some(expression) = expression.as_expression() else {
                evidence.is_unknown = true;
                return;
            };
            if let Some(value) = immutable_static_string(expression, ctx, &mut Vec::new()) {
                if !value.trim().is_empty() {
                    record_text_contributor(inherited_visibility, evidence);
                }
            } else {
                evidence.is_unknown = true;
            }
        }
    }
}

fn collect_element_name_evidence<'a>(
    element: &JSXElement<'a>,
    inherited_visibility: &ResponsiveVisibility,
    evidence: &mut AccessibleNameEvidence,
    ctx: &LintContext<'a>,
) {
    let opening_element = &element.opening_element;
    let Some(tag_name) = exact_intrinsic_tag_name(opening_element, ctx) else {
        evidence.is_unknown = true;
        return;
    };
    let Some(is_excluded) = resolve_subtree_exclusion(opening_element) else {
        evidence.is_unknown = true;
        return;
    };
    if is_excluded {
        return;
    }
    if is_opaque_name_tag(&tag_name)
        || is_interactive_element(&tag_name, opening_element)
        || has_potential_non_content_name(
            opening_element,
            &[
                "aria-label",
                "aria-labelledby",
                "title",
                "alt",
                "placeholder",
                "value",
            ],
            ctx,
        )
        || get_authoritative_jsx_attribute(opening_element, "role", false).is_some()
    {
        evidence.is_unknown = true;
        return;
    }
    let Some(own_visibility) = resolve_element_visibility(opening_element, ctx) else {
        evidence.is_unknown = true;
        return;
    };
    if own_visibility.is_inert || own_visibility.has_generated_content {
        evidence.is_unknown = true;
        return;
    }
    collect_accessible_name_evidence(
        &element.children,
        &combine_visibility(inherited_visibility, &own_visibility),
        evidence,
        ctx,
    );
}

fn is_opaque_name_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "area"
            | "audio"
            | "canvas"
            | "embed"
            | "iframe"
            | "img"
            | "input"
            | "math"
            | "object"
            | "script"
            | "select"
            | "slot"
            | "style"
            | "svg"
            | "template"
            | "textarea"
            | "video"
    )
}

fn is_interactive_element(tag_name: &str, opening_element: &JSXOpeningElement<'_>) -> bool {
    match tag_name {
        "audio" | "button" | "canvas" | "datalist" | "embed" | "menuitem" | "option" | "select"
        | "summary" | "td" | "th" | "tr" | "textarea" | "video" => true,
        "input" => get_authoritative_jsx_attribute(opening_element, "type", false)
            .and_then(|attribute| match attribute.value.as_ref() {
                Some(JSXAttributeValue::StringLiteral(value)) => Some(value.value.as_str()),
                _ => None,
            })
            .is_none_or(|input_type| !input_type.eq_ignore_ascii_case("hidden")),
        "a" | "area" => get_authoritative_jsx_attribute(opening_element, "href", false).is_some(),
        "img" => get_authoritative_jsx_attribute(opening_element, "usemap", false).is_some(),
        _ => false,
    }
}

fn immutable_static_string(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => Some(value.value.to_string()),
        Expression::TemplateLiteral(template)
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
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_kind(declaration.id()),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            visited_symbols.push(symbol_id);
            let value = immutable_static_string(declarator.init.as_ref()?, ctx, visited_symbols);
            visited_symbols.pop();
            value
        }
        _ => None,
    }
}

fn exhaustive_static_string_attribute_values(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    ctx: &LintContext<'_>,
) -> Option<Vec<String>> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(vec![value.value.to_string()]),
        JSXAttributeValue::ExpressionContainer(container) => exhaustive_static_string_values(
            container.expression.as_expression()?,
            ctx,
            &mut Vec::new(),
        ),
        _ => None,
    }
}

fn exhaustive_static_string_values(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => Some(vec![value.value.to_string()]),
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
            if let Expression::BooleanLiteral(test) = conditional.test.get_inner_expression() {
                return exhaustive_static_string_values(
                    if test.value {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    visited_symbols,
                );
            }
            let mut consequent = exhaustive_static_string_values(
                &conditional.consequent,
                ctx,
                &mut visited_symbols.clone(),
            )?;
            consequent.extend(exhaustive_static_string_values(
                &conditional.alternate,
                ctx,
                &mut visited_symbols.clone(),
            )?);
            Some(consequent)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_kind(declaration.id()),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            visited_symbols.push(symbol_id);
            let values =
                exhaustive_static_string_values(declarator.init.as_ref()?, ctx, visited_symbols);
            visited_symbols.pop();
            values
        }
        _ => None,
    }
}

fn record_text_contributor(
    visibility: &ResponsiveVisibility,
    evidence: &mut AccessibleNameEvidence,
) {
    evidence.did_find_contributor = true;
    for (available, is_visible) in evidence
        .availability
        .iter_mut()
        .zip(effective_visibility(visibility))
    {
        *available |= is_visible;
    }
}
