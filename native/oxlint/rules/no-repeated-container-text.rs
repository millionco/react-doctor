use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXChild},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedContainerText;
declare_oxc_lint!(
    /// Disallow repeated card text in distinct structural slots.
    NoRepeatedContainerText,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated card text in distinct structural slots."
);

#[derive(Default)]
struct RepeatedTextCollection {
    descendants: usize,
    is_static: bool,
    occurrences: rustc_hash::FxHashMap<String, Vec<(oxc_span::Span, String)>>,
}

impl Rule for NoRepeatedContainerText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let Some(name) = no_repeated_name(&element.opening_element) else {
            return;
        };
        if !matches!(name, "article" | "aside" | "div" | "section")
            || !has_capability_or_unspecified(ctx, "tailwind")
            || !is_tailwind_card_surface(&element.opening_element)
            || no_repeated_responsive(&element.opening_element)
            || no_repeated_skip(&element.opening_element, true, ctx)
        {
            return;
        }
        let mut collection = RepeatedTextCollection {
            is_static: true,
            ..Default::default()
        };
        for child in &element.children {
            no_repeated_collect(child, &mut Vec::new(), &mut collection, ctx);
        }
        if !collection.is_static {
            return;
        }
        for (text, occurrences) in collection.occurrences {
            let signatures = occurrences
                .iter()
                .map(|(_, signature)| signature)
                .collect::<rustc_hash::FxHashSet<_>>();
            if occurrences.len() >= 3 && signatures.len() >= 3 {
                ctx.diagnostic(OxcDiagnostic::warn(format!("The literal \"{text}\" appears in {} structurally different spots inside this card. Keep it in the one slot where it matters most.", signatures.len())).with_label(occurrences[0].0));
            }
        }
    }
}
fn no_repeated_name<'a>(opening: &'a oxc_ast::ast::JSXOpeningElement<'a>) -> Option<&'a str> {
    match &opening.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier)
            if identifier.name == identifier.name.to_ascii_lowercase() =>
        {
            Some(identifier.name.as_str())
        }
        _ => None,
    }
}
fn no_repeated_responsive(opening: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(class_name) = get_static_class_name(opening) else {
        return false;
    };
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        let visible = !matches!(
            get_tailwind_visibility_effect(token.utility),
            TailwindVisibilityEffectResolution::NotRelevant
        ) || matches!(token.utility, "sr-only" | "not-sr-only");
        visible
            && token.variants.iter().any(|variant| {
                matches!(*variant, "sm" | "md" | "lg" | "xl" | "2xl")
                    || variant.strip_prefix("max-").is_some_and(|breakpoint| {
                        matches!(breakpoint, "sm" | "md" | "lg" | "xl" | "2xl")
                    })
                    || variant
                        .strip_prefix("min-[")
                        .and_then(|value| value.strip_suffix(']'))
                        .is_some_and(|value| !value.is_empty())
                    || variant
                        .strip_prefix("max-[")
                        .and_then(|value| value.strip_suffix(']'))
                        .is_some_and(|value| !value.is_empty())
            })
    })
}
fn no_repeated_hidden<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(attribute) = get_authoritative_jsx_attribute(opening, "hidden", true) {
        if attribute.value.is_none()
            || get_string_literal_attribute_value(attribute)
                .is_none_or(|value| !value.eq_ignore_ascii_case("false"))
        {
            return true;
        }
    }
    if let Some(attribute) = get_authoritative_jsx_attribute(opening, "aria-hidden", true) {
        if get_string_literal_attribute_value(attribute)
            .is_none_or(|value| value.eq_ignore_ascii_case("true"))
        {
            return true;
        }
    }
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening, "style", true) {
        let Some(style) = get_inline_style_object_expression_with_aliases(style_attribute, ctx)
        else {
            return false;
        };
        for name in ["display", "visibility"] {
            if let Some(property) = get_effective_static_style_property(style, name) {
                let value = get_object_property_string_value(property);
                if value.is_none()
                    || value.is_some_and(|value| {
                        matches!(
                            value.trim().to_ascii_lowercase().as_str(),
                            "none" | "hidden" | "collapse"
                        )
                    })
                {
                    return true;
                }
            }
        }
    }
    let Some(class_name) = get_static_class_name(opening) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    if tokens.iter().any(|token| {
        matches!(
            token.utility,
            "screen-reader-only" | "sr-only" | "visually-hidden"
        )
    }) || get_effective_tailwind_class_name_token(&tokens, |utility| {
        matches!(utility, "sr-only" | "not-sr-only")
    }) == Some("sr-only")
    {
        return true;
    }
    get_tailwind_visibility_at_breakpoints(class_name)
        .is_some_and(|values| values.iter().all(|value| !value))
}
fn no_repeated_skip<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    root: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(name) = no_repeated_name(opening) else {
        return true;
    };
    if matches!(
        name,
        "a" | "button"
            | "canvas"
            | "code"
            | "datalist"
            | "dd"
            | "dl"
            | "dt"
            | "figure"
            | "input"
            | "kbd"
            | "label"
            | "menu"
            | "nav"
            | "ol"
            | "option"
            | "optgroup"
            | "pre"
            | "samp"
            | "select"
            | "summary"
            | "svg"
            | "table"
            | "tbody"
            | "td"
            | "textarea"
            | "tfoot"
            | "th"
            | "thead"
            | "tr"
            | "ul"
    ) {
        return true;
    }
    if opening.attributes.iter().any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)) || matches!(attribute, JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if matches!(identifier.name.as_str(), "children" | "dangerouslySetInnerHTML")))) { return true; }
    let class_attribute = get_authoritative_jsx_attribute(opening, "className", true);
    let class_name = get_static_class_name(opening);
    if class_attribute.is_some() && class_name.is_none()
        || class_name.is_some_and(no_repeated_data_visualization_class)
        || no_repeated_hidden(opening, ctx)
    {
        return true;
    }
    if let Some(role) = get_authoritative_jsx_attribute(opening, "role", true) {
        let Some(role) = get_string_literal_attribute_value(role) else {
            return true;
        };
        if role.is_empty()
            || matches!(
                role.to_ascii_lowercase().as_str(),
                "button"
                    | "cell"
                    | "grid"
                    | "gridcell"
                    | "graphics-document"
                    | "graphics-symbol"
                    | "img"
                    | "link"
                    | "list"
                    | "listbox"
                    | "listitem"
                    | "menu"
                    | "menubar"
                    | "navigation"
                    | "progressbar"
                    | "radiogroup"
                    | "row"
                    | "rowgroup"
                    | "table"
                    | "tablist"
                    | "tree"
                    | "treeitem"
                    | "diagram"
            )
        {
            return true;
        }
    }
    !root && is_tailwind_card_surface(opening)
}
fn no_repeated_data_visualization_class(value: &str) -> bool {
    value
        .to_ascii_lowercase()
        .split(|character: char| character == '-' || character == '_' || character.is_whitespace())
        .any(|part| {
            matches!(
                part,
                "chart" | "graph" | "heatmap" | "plot" | "visualization"
            )
        })
}
fn no_repeated_signature(opening: &oxc_ast::ast::JSXOpeningElement<'_>) -> Option<String> {
    let name = no_repeated_name(opening)?;
    let Some(class_name) = get_static_class_name(opening) else {
        return Some(name.to_string());
    };
    let parsed_tokens = tailwind_class_name_tokens(class_name);
    if parsed_tokens.is_empty() {
        return Some(name.to_string());
    }
    let mut tokens = parsed_tokens
        .iter()
        .map(|token| token.raw_token)
        .collect::<Vec<_>>();
    tokens.sort_unstable();
    Some(format!("{name}.{}", tokens.join(".")))
}
fn no_repeated_append(
    value: &str,
    span: oxc_span::Span,
    path: &[String],
    collection: &mut RepeatedTextCollection,
) {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let text_length = text.encode_utf16().count();
    if text_length < 4 || text_length > 48 || !text.chars().any(char::is_alphabetic) {
        return;
    }
    collection
        .occurrences
        .entry(text)
        .or_default()
        .push((span, path.join(">")));
}
fn no_repeated_collect<'a>(
    child: &'a JSXChild<'a>,
    path: &mut Vec<String>,
    collection: &mut RepeatedTextCollection,
    ctx: &LintContext<'a>,
) {
    if !collection.is_static {
        return;
    }
    match child {
        JSXChild::Text(text) => {
            no_repeated_append(text.value.as_str(), text.span, path, collection)
        }
        JSXChild::Element(element) => {
            if no_repeated_skip(&element.opening_element, false, ctx) {
                return;
            }
            collection.descendants += 1;
            if collection.descendants > 250 || no_repeated_responsive(&element.opening_element) {
                collection.is_static = false;
                return;
            }
            let Some(segment) = no_repeated_signature(&element.opening_element) else {
                return;
            };
            path.push(segment);
            for child in &element.children {
                no_repeated_collect(child, path, collection, ctx);
            }
            path.pop();
        }
        JSXChild::Fragment(fragment) => {
            for child in &fragment.children {
                no_repeated_collect(child, path, collection, ctx);
            }
        }
        JSXChild::ExpressionContainer(container) => match container
            .expression
            .as_expression()
            .map(Expression::get_inner_expression)
        {
            Some(Expression::StringLiteral(value)) => {
                no_repeated_append(value.value.as_str(), value.span, path, collection)
            }
            Some(Expression::TemplateLiteral(template)) if template.expressions.is_empty() => {
                if let Some(quasi) = template.quasis.first() {
                    no_repeated_append(
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |value| value.as_str()),
                        template.span,
                        path,
                        collection,
                    );
                }
            }
            Some(
                Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_),
            ) => {}
            None => {}
            _ => collection.is_static = false,
        },
        _ => collection.is_static = false,
    }
}
