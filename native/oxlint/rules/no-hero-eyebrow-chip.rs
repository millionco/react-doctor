use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const HERO_EYEBROW_DASH_MAX_HEIGHT_PX: f64 = 6.0;
const HERO_EYEBROW_DASH_MAX_WIDTH_PX: f64 = 80.0;
const HERO_EYEBROW_DASH_MIN_HEIGHT_PX: f64 = 1.0;
const HERO_EYEBROW_DASH_MIN_WIDTH_PX: f64 = 8.0;
const HERO_EYEBROW_LABEL_MAX_FONT_SIZE_PX: f64 = 14.0;
const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS: usize = 32;
const MESSAGE: &str = "This small decorative label immediately above a display headline creates a generic hero scaffold. Fold the context into stronger content structure.";
const HERO_HEADING_SIZE_CLASSES: [&str; 5] =
    ["text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
static CHROMATIC_TAILWIND_BACKGROUND_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+$"
);
static STATIC_ARBITRARY_TRACKING_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)^tracking-\[(?:length:)?(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))(?:em|px|rem)\]$"
);

#[derive(Clone, Copy)]
struct EffectivePseudoUtility<'a> {
    is_ambiguous: bool,
    utility: Option<&'a str>,
}

#[derive(Debug, Default, Clone)]
pub struct NoHeroEyebrowChip;

declare_oxc_lint!(
    /// Disallow decorative eyebrow labels directly above display headlines.
    NoHeroEyebrowChip,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative hero eyebrow labels.",
);

impl Rule for NoHeroEyebrowChip {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let label_text = normalize_static_jsx_whitespace(&get_static_jsx_text(element));
        if label_text.is_empty()
            || label_text.encode_utf16().count() > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let label_tokens = tailwind_class_name_tokens(class_name);
        let effective_text_transform =
            get_effective_tailwind_class_name_token(&label_tokens, |utility| {
                matches!(
                    utility,
                    "capitalize" | "lowercase" | "normal-case" | "uppercase"
                )
            });
        let effective_tracking =
            get_effective_tailwind_class_name_token(&label_tokens, |utility| {
                utility.starts_with("tracking-")
            });
        let is_tracked_label = effective_text_transform == Some("uppercase")
            && effective_tracking.is_some_and(is_non_normal_tracking_utility);
        let is_pill_label = !is_tracked_label && is_pill_label(&label_tokens);
        if !is_tracked_label
            && !is_pill_label
            && !get_static_tailwind_font_size(class_name).is_some_and(|font_size| {
                font_size <= HERO_EYEBROW_LABEL_MAX_FONT_SIZE_PX
                    && has_static_dash_pseudo_element(class_name)
            })
        {
            return;
        }

        let Some(heading) = get_next_static_jsx_element_sibling(element, node, ctx) else {
            return;
        };
        if !matches!(
            &heading.opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "h1"
        ) {
            return;
        }
        let heading_tokens = get_static_class_name(&heading.opening_element)
            .map(tailwind_class_name_tokens)
            .unwrap_or_default();
        let effective_heading_size =
            get_effective_tailwind_class_name_token(&heading_tokens, |utility| {
                parse_static_tailwind_font_size(utility).is_some()
            });
        if !effective_heading_size
            .is_some_and(|utility| HERO_HEADING_SIZE_CLASSES.contains(&utility))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_pill_label(tokens: &[TailwindClassNameToken<'_>]) -> bool {
    if get_effective_tailwind_class_name_token(tokens, is_base_rounding_utility)
        != Some("rounded-full")
        || !get_effective_tailwind_class_name_token(tokens, |utility| {
            utility.starts_with("p-") || utility.starts_with("px-")
        })
        .is_some_and(has_positive_pill_padding)
    {
        return false;
    }
    let marked_utilities = tokens
        .iter()
        .filter(|token| token.variants.is_empty())
        .map(|token| {
            if token.is_important {
                format!("!{}", token.utility)
            } else {
                token.utility.to_string()
            }
        })
        .collect::<Vec<_>>();
    let marked_utility_refs = marked_utilities
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    has_visible_tailwind_fill_or_edge(&marked_utility_refs)
}

fn is_non_normal_tracking_utility(utility: &str) -> bool {
    if utility == "tracking-normal" {
        return false;
    }
    if matches!(
        utility,
        "tracking-tight"
            | "tracking-tighter"
            | "tracking-wide"
            | "tracking-wider"
            | "tracking-widest"
    ) {
        return true;
    }
    STATIC_ARBITRARY_TRACKING_PATTERN
        .captures(utility)
        .and_then(|captures| captures.get(1))
        .and_then(|capture| capture.as_str().parse::<f64>().ok())
        .is_some_and(|tracking| tracking != 0.0)
}

fn is_base_rounding_utility(utility: &str) -> bool {
    let Some(rounding) = utility.strip_prefix("rounded-") else {
        return utility == "rounded";
    };
    ![
        "b", "bl", "br", "e", "ee", "es", "l", "r", "s", "se", "ss", "t", "tl", "tr",
    ]
    .iter()
    .any(|edge| {
        rounding
            .strip_prefix(edge)
            .is_some_and(|suffix| suffix.starts_with('-'))
    })
}

fn has_positive_pill_padding(utility: &str) -> bool {
    let Some(value) = utility
        .strip_prefix("px-")
        .or_else(|| utility.strip_prefix("p-"))
    else {
        return false;
    };
    if value == "px" {
        return true;
    }
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return parse_javascript_decimal_prefix_value(value).is_some_and(|padding| padding > 0.0);
    }
    let arbitrary_value = value.strip_prefix('[').and_then(|value| {
        value
            .strip_suffix("px]")
            .or_else(|| value.strip_suffix("rem]"))
    });
    arbitrary_value.is_some_and(|value| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
            && parse_javascript_decimal_prefix_value(value).is_some_and(|padding| padding > 0.0)
    })
}

fn has_static_dash_pseudo_element(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let mut before_tokens = Vec::new();
    let mut after_tokens = Vec::new();
    for token in &tokens {
        if token.variants.len() != 1 {
            continue;
        }
        match token.variants[0] {
            "before" => before_tokens.push(token),
            "after" => after_tokens.push(token),
            _ => {}
        }
    }
    for pseudo_tokens in [&before_tokens, &after_tokens] {
        let content = resolve_effective_pseudo_utility(pseudo_tokens, |utility| {
            utility.starts_with("content-") || utility.starts_with("[content:")
        });
        let display = resolve_effective_pseudo_utility(pseudo_tokens, |utility| {
            matches!(
                utility,
                "block"
                    | "contents"
                    | "flex"
                    | "grid"
                    | "hidden"
                    | "inline"
                    | "inline-block"
                    | "inline-flex"
                    | "inline-grid"
            )
        });
        let width =
            resolve_effective_pseudo_utility(pseudo_tokens, |utility| utility.starts_with("w-"));
        let height =
            resolve_effective_pseudo_utility(pseudo_tokens, |utility| utility.starts_with("h-"));
        let background =
            resolve_effective_pseudo_utility(pseudo_tokens, is_tailwind_background_color);
        let background_opacity = resolve_effective_pseudo_utility(pseudo_tokens, |utility| {
            utility.starts_with("bg-opacity-")
        });
        if content.is_ambiguous
            || display.is_ambiguous
            || width.is_ambiguous
            || height.is_ambiguous
            || background.is_ambiguous
            || background_opacity.is_ambiguous
            || !content.utility.is_some_and(|utility| {
                matches!(
                    utility,
                    "content-[\"\"]" | "content-['']" | "[content:\"\"]" | "[content:'']"
                )
            })
            || !matches!(display.utility, Some("block" | "inline-block"))
            || !background
                .utility
                .is_some_and(has_chromatic_tailwind_background)
            || background_opacity
                .utility
                .is_some_and(|utility| utility != "bg-opacity-100")
        {
            continue;
        }
        let width_px = width
            .utility
            .and_then(|utility| parse_static_tailwind_length_px(utility, "w"));
        let height_px = height
            .utility
            .and_then(|utility| parse_static_tailwind_length_px(utility, "h"));
        if width_px.is_some_and(|width| {
            (HERO_EYEBROW_DASH_MIN_WIDTH_PX..=HERO_EYEBROW_DASH_MAX_WIDTH_PX).contains(&width)
        }) && height_px.is_some_and(|height| {
            (HERO_EYEBROW_DASH_MIN_HEIGHT_PX..=HERO_EYEBROW_DASH_MAX_HEIGHT_PX).contains(&height)
        }) {
            return true;
        }
    }
    false
}

fn resolve_effective_pseudo_utility<'a>(
    tokens: &[&TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
) -> EffectivePseudoUtility<'a> {
    let has_important_token = tokens
        .iter()
        .any(|token| predicate(token.utility) && token.is_important);
    let mut effective_utility = None;
    for token in tokens {
        if !predicate(token.utility) || has_important_token && !token.is_important {
            continue;
        }
        if effective_utility.is_some_and(|utility| utility != token.utility) {
            return EffectivePseudoUtility {
                is_ambiguous: true,
                utility: None,
            };
        }
        effective_utility = Some(token.utility);
    }
    EffectivePseudoUtility {
        is_ambiguous: false,
        utility: effective_utility,
    }
}

fn is_tailwind_background_color(utility: &str) -> bool {
    let (utility, modifier) = split_tailwind_opacity_modifier(utility);
    if modifier.is_some_and(str::is_empty) {
        return false;
    }
    let Some(background) = utility.strip_prefix("bg-") else {
        return false;
    };
    if matches!(
        background,
        "transparent" | "black" | "white" | "current" | "inherit"
    ) {
        return true;
    }
    if let Some(arbitrary) = background
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        return !arbitrary.is_empty()
            && !arbitrary.starts_with("url(")
            && !["image:", "length:", "position:", "size:"]
                .iter()
                .any(|prefix| arbitrary.starts_with(prefix));
    }
    let Some((color, shade)) = background.rsplit_once('-') else {
        return false;
    };
    is_tailwind_color_name(color)
        && !shade.is_empty()
        && shade.bytes().all(|byte| byte.is_ascii_digit())
}

fn has_chromatic_tailwind_background(utility: &str) -> bool {
    if CHROMATIC_TAILWIND_BACKGROUND_PATTERN.is_match(utility) {
        return true;
    }
    let Some(color) = utility
        .strip_prefix("bg-[")
        .and_then(|value| value.strip_suffix(']'))
        .map(|value| value.strip_prefix("color:").unwrap_or(value))
    else {
        return false;
    };
    let lowercase_color = color.to_ascii_lowercase();
    if lowercase_color.starts_with("rgba(") || lowercase_color.starts_with("hsla(") {
        return false;
    }
    if lowercase_color.strip_prefix('#').is_some_and(|hex| {
        matches!(hex.len(), 4 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return false;
    }
    parse_color_to_rgb(color).is_some_and(|color| has_color_chroma(color))
}

fn is_tailwind_color_name(color: &str) -> bool {
    matches!(
        color,
        "slate"
            | "gray"
            | "zinc"
            | "neutral"
            | "stone"
            | "red"
            | "orange"
            | "amber"
            | "yellow"
            | "lime"
            | "green"
            | "emerald"
            | "teal"
            | "cyan"
            | "sky"
            | "blue"
            | "indigo"
            | "violet"
            | "purple"
            | "fuchsia"
            | "pink"
            | "rose"
    )
}
