use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Tailwind cannot reliably discover this dynamically assembled utility. Write each complete class token as a static string.";
static TAILWIND_DIRECT_VALUE_FRAGMENT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^(?:accent|animate|aspect|basis|bg|border(?:-[trblxy])?|bottom|caret|col-span|columns|content|decoration|delay|divide-[xy]|duration|ease|fill|flex|font|from|gap(?:-[xy])?|grid-(?:cols|rows)|grow|h|inset(?:-[xy])?|items|justify|leading|left|m[trblxy]?|max-[wh]|min-[wh]|object|opacity|order|outline|overflow|p[trblxy]?|place-(?:content|items|self)|placeholder|right|ring(?:-offset)?|rotate|rounded(?:-[trbl]{1,2})?|row-span|scale|self|shadow|shrink|size|skew-[xy]|space-[xy]|stroke|text|to|top|tracking|translate-[xy]|via|w|z)-(?:\[.*)?$"
);
static TAILWIND_COLOR_FRAGMENT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^(?:accent|bg|border(?:-[trblxy])?|caret|decoration|divide-[xy]|fill|from|outline|placeholder|ring|stroke|text|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[0-9]{2,3})?/?$"
);

#[derive(Debug, Default, Clone)]
pub struct NoDynamicTailwindClassFragment;

declare_oxc_lint!(
    /// Disallow dynamically assembled Tailwind utility fragments.
    NoDynamicTailwindClassFragment,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow dynamically assembled Tailwind utility fragments.",
);

impl Rule for NoDynamicTailwindClassFragment {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        if !matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name == "className"
        ) {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = ctx.nodes().parent_kind(node.id()) else {
            return;
        };
        if opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref()
        else {
            return;
        };
        let JSXExpression::TemplateLiteral(template_literal) = &container.expression else {
            return;
        };
        if !template_literal
            .quasis
            .iter()
            .take(template_literal.expressions.len())
            .any(|quasi| has_dynamic_tailwind_class_fragment(quasi.value.raw.as_str()))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(template_literal.span));
    }
}

fn has_dynamic_tailwind_class_fragment(preceding_static_text: &str) -> bool {
    let token_fragment = preceding_static_text
        .rsplit_once(|character| is_js_whitespace(character))
        .map_or(preceding_static_text, |(_, fragment)| fragment);
    let unvariant_fragment = token_fragment
        .rsplit_once(':')
        .map_or(token_fragment, |(_, fragment)| fragment);
    let utility_fragment = unvariant_fragment
        .strip_prefix(['!', '-'])
        .unwrap_or(unvariant_fragment);
    TAILWIND_DIRECT_VALUE_FRAGMENT_PATTERN.is_match(utility_fragment)
        || TAILWIND_COLOR_FRAGMENT_PATTERN.is_match(utility_fragment)
}
