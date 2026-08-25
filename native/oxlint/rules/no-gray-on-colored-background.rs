use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const LIGHT_BG_DARK_GRAY_MIN_SHADE: i32 = 700;
const LIGHT_BG_MAX_SHADE: i32 = 500;
const WASHED_OUT_SHADE_GAP_MAX: i32 = 400;
static GRAY_TEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^text-(?:gray|slate|zinc|neutral|stone)-(?:[4-9]00|950)(?-u:\b)");
static COLORED_BG_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[5-9]00|950)(?-u:\b)"
);
static TEXT_COLOR_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^text-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)"
);
static BG_COLOR_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^bg-(?:white|black|transparent|current|inherit|\[|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-)"
);
static ARBITRARY_OPACITY_PATTERN: Lazy<Regex> = lazy_regex!(r"^\[([0-9.]+)%?\]$");

struct ScopedTailwindUtilities<'a> {
    scope: String,
    utilities: Vec<ScopedTailwindUtility<'a>>,
}

#[derive(Clone, Copy)]
struct ScopedTailwindUtility<'a> {
    is_important: bool,
    utility: &'a str,
}

#[derive(Debug, Default, Clone)]
pub struct NoGrayOnColoredBackground;

declare_oxc_lint!(
    /// Disallow washed-out gray text on saturated colored backgrounds.
    NoGrayOnColoredBackground,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow gray text on colored backgrounds.",
);

impl Rule for NoGrayOnColoredBackground {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_proven_intrinsic_jsx_element(opening_element, ctx) {
            return;
        }
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let mut text_colors_by_scope = Vec::new();
        let mut background_colors_by_scope = Vec::new();
        for token in &tokens {
            if TEXT_COLOR_PATTERN.is_match(token.utility) {
                add_scoped_utility(
                    &mut text_colors_by_scope,
                    &token.variants,
                    token.utility,
                    token.is_important,
                );
            }
            if BG_COLOR_PATTERN.is_match(token.utility) {
                add_scoped_utility(
                    &mut background_colors_by_scope,
                    &token.variants,
                    token.utility,
                    token.is_important,
                );
            }
        }

        for text_scope in &text_colors_by_scope {
            let gray_utility = effective_scoped_utility(&text_scope.utilities);
            let colored_utility =
                find_scoped_utilities(&background_colors_by_scope, &text_scope.scope)
                    .and_then(|scope| effective_scoped_utility(&scope.utilities));
            if let (Some(gray_utility), Some(colored_utility)) = (gray_utility, colored_utility)
                && gray_background_pair_is_reportable(gray_utility, colored_utility)
            {
                report_gray_background_pair(opening_element, gray_utility, colored_utility, ctx);
                return;
            }
        }

        let base_gray_text = find_scoped_utilities(&text_colors_by_scope, "")
            .and_then(|scope| effective_scoped_utility(&scope.utilities));
        if let Some(base_gray_text) = base_gray_text
            && GRAY_TEXT_PATTERN.is_match(base_gray_text)
        {
            for background_scope in &background_colors_by_scope {
                if background_scope.scope.is_empty()
                    || find_scoped_utilities(&text_colors_by_scope, &background_scope.scope)
                        .is_some()
                {
                    continue;
                }
                let Some(colored_utility) = effective_scoped_utility(&background_scope.utilities)
                else {
                    continue;
                };
                if gray_background_pair_is_reportable(base_gray_text, colored_utility) {
                    report_gray_background_pair(
                        opening_element,
                        base_gray_text,
                        colored_utility,
                        ctx,
                    );
                    return;
                }
            }
        }

        let base_colored_background = find_scoped_utilities(&background_colors_by_scope, "")
            .and_then(|scope| effective_scoped_utility(&scope.utilities));
        if let Some(base_colored_background) = base_colored_background
            && COLORED_BG_PATTERN.is_match(base_colored_background)
            && has_opaque_tailwind_color_modifier(base_colored_background)
        {
            for text_scope in &text_colors_by_scope {
                if text_scope.scope.is_empty()
                    || find_scoped_utilities(&background_colors_by_scope, &text_scope.scope)
                        .is_some()
                {
                    continue;
                }
                let Some(gray_utility) = effective_scoped_utility(&text_scope.utilities) else {
                    continue;
                };
                if GRAY_TEXT_PATTERN.is_match(gray_utility)
                    && is_washed_out_pair(gray_utility, base_colored_background)
                {
                    report_gray_background_pair(
                        opening_element,
                        gray_utility,
                        base_colored_background,
                        ctx,
                    );
                    return;
                }
            }
        }
    }
}

fn add_scoped_utility<'a>(
    utilities_by_scope: &mut Vec<ScopedTailwindUtilities<'a>>,
    variants: &[&str],
    utility: &'a str,
    is_important: bool,
) {
    let mut sorted_variants = variants.to_vec();
    sorted_variants.sort_unstable();
    let scope = sorted_variants.join(":");
    if let Some(scoped_utilities) = utilities_by_scope
        .iter_mut()
        .find(|candidate| candidate.scope == scope)
    {
        scoped_utilities.utilities.push(ScopedTailwindUtility {
            is_important,
            utility,
        });
        return;
    }
    utilities_by_scope.push(ScopedTailwindUtilities {
        scope,
        utilities: vec![ScopedTailwindUtility {
            is_important,
            utility,
        }],
    });
}

fn find_scoped_utilities<'a, 'b>(
    utilities_by_scope: &'b [ScopedTailwindUtilities<'a>],
    scope: &str,
) -> Option<&'b ScopedTailwindUtilities<'a>> {
    utilities_by_scope
        .iter()
        .find(|candidate| candidate.scope == scope)
}

fn effective_scoped_utility<'a>(utilities: &[ScopedTailwindUtility<'a>]) -> Option<&'a str> {
    let has_important_utility = utilities.iter().any(|utility| utility.is_important);
    let mut effective_utility = None;
    for utility in utilities {
        if has_important_utility && !utility.is_important {
            continue;
        }
        if effective_utility.is_some_and(|current| current != utility.utility) {
            return None;
        }
        effective_utility = Some(utility.utility);
    }
    effective_utility
}

fn has_opaque_tailwind_color_modifier(utility: &str) -> bool {
    let (_, modifier) = split_tailwind_opacity_modifier(utility);
    let Some(modifier) = modifier else {
        return true;
    };
    if modifier == "100" {
        return true;
    }
    let Some(captures) = ARBITRARY_OPACITY_PATTERN.captures(modifier) else {
        return false;
    };
    let Some(opacity) = parse_javascript_decimal_prefix_value(&captures[1]) else {
        return false;
    };
    if modifier.ends_with("%]") {
        opacity == 100.0
    } else {
        opacity == 1.0
    }
}

fn utility_shade(utility: &str) -> Option<i32> {
    let (utility_without_modifier, _) = split_tailwind_opacity_modifier(utility);
    let shade = utility_without_modifier.rsplit_once('-')?.1;
    if !shade.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    shade.parse().ok()
}

fn is_washed_out_pair(gray_utility: &str, colored_utility: &str) -> bool {
    let Some(gray_shade) = utility_shade(gray_utility) else {
        return true;
    };
    let Some(background_shade) = utility_shade(colored_utility) else {
        return true;
    };
    if (gray_shade - background_shade).abs() > WASHED_OUT_SHADE_GAP_MAX {
        return false;
    }
    let background_hue = colored_utility
        .strip_prefix("bg-")
        .and_then(|utility| utility.split_once('-'))
        .map(|(hue, _)| hue);
    if background_hue.is_some_and(|hue| matches!(hue, "yellow" | "amber" | "lime"))
        && background_shade <= LIGHT_BG_MAX_SHADE
        && gray_shade >= LIGHT_BG_DARK_GRAY_MIN_SHADE
    {
        return false;
    }
    true
}

fn gray_background_pair_is_reportable(gray_utility: &str, colored_utility: &str) -> bool {
    GRAY_TEXT_PATTERN.is_match(gray_utility)
        && COLORED_BG_PATTERN.is_match(colored_utility)
        && has_opaque_tailwind_color_modifier(colored_utility)
        && is_washed_out_pair(gray_utility, colored_utility)
}

fn report_gray_background_pair(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    gray_utility: &str,
    colored_utility: &str,
    ctx: &LintContext<'_>,
) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Your users see washed-out gray text ({gray_utility}) on a colored background ({colored_utility}), so use white or a darker shade of the background color."
        ))
        .with_label(opening_element.span),
    );
}
