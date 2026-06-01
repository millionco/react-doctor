//! ESLint / Flow rule-suppression detection, ported from
//! `Entrypoint/Suppression.ts` (`findProgramSuppressions` +
//! `filterSuppressionsThatAffectFunction`).
//!
//! A React rule suppression comment (`// eslint-disable-next-line
//! react-hooks/rules-of-hooks`, a `/* eslint-disable react-hooks/… */` … `/*
//! eslint-enable … */` block, or a Flow `$FlowFixMe[react-rule…]`) signals that
//! the developer has knowingly disabled a React lint rule, so the React Compiler
//! cannot trust that the function follows the rules of React — it
//! [`tryCompileFunction`](crate::compile)s the function but returns a structured
//! error (`suppressionsToCompilerError`) and `processFn` leaves the original
//! source untouched.
//!
//! This module mirrors the TS comment-span bookkeeping. The crucial detail
//! (`Program.ts::compileProgram`) is that suppressions are only *collected* when
//! the compiler is NOT itself validating both hooks usage and exhaustive memo
//! dependencies — if it is, it reports those violations directly and ignores
//! eslint suppressions (see [`suppression_rules`]).

use oxc::ast::Comment;

/// The default eslint rule names whose suppression triggers a skip
/// (`Program.ts::DEFAULT_ESLINT_SUPPRESSIONS`).
pub const DEFAULT_ESLINT_SUPPRESSIONS: [&str; 2] =
    ["react-hooks/exhaustive-deps", "react-hooks/rules-of-hooks"];

/// Where a suppression came from (`Suppression.ts` `SuppressionSource`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuppressionSource {
    Eslint,
    Flow,
}

/// A `disable`/`enable` comment pair (`Suppression.ts` `SuppressionRange`). For a
/// line comment / Flow suppression, `disable` and `enable` are the same span. The
/// `enable` span is `None` when only a disable block is present (the rest of the
/// file has potential violations).
#[derive(Clone, Copy, Debug)]
pub struct SuppressionRange {
    /// `[start, end)` byte span of the disable comment (delimiters included),
    /// matching babel's `comment.start`/`comment.end`.
    pub disable: (u32, u32),
    /// `[start, end)` byte span of the enable comment. `None` ⇒ the disable block
    /// is *unclosed* (`enableComment === null` in the TS): the rest of the file has
    /// potential violations. For a line-comment / Flow suppression this is
    /// `Some(disable)` (the same span).
    pub enable: Option<(u32, u32)>,
    pub source: SuppressionSource,
}

/// The active eslint suppression rule set for a module, ported from the
/// `findProgramSuppressions` call site in `Program.ts::compileProgram`:
///
/// ```text
/// validateExhaustiveMemoizationDependencies && validateHooksUsage
///   ? null
///   : (eslintSuppressionRules ?? DEFAULT_ESLINT_SUPPRESSIONS)
/// ```
///
/// Returns `None` (eslint suppression detection disabled) when both validations
/// are on; otherwise the configured `@eslintSuppressionRules` or the built-in
/// default set. An empty rule list disables eslint detection (the pattern would
/// otherwise be an empty alternation matching everything — the bug
/// `empty-eslint-suppressions-config` guards against).
pub fn suppression_rules(
    validate_hooks_usage: bool,
    validate_exhaustive_memoization_dependencies: bool,
    eslint_suppression_rules: Option<&[String]>,
) -> Option<Vec<String>> {
    if validate_exhaustive_memoization_dependencies && validate_hooks_usage {
        return None;
    }
    match eslint_suppression_rules {
        Some(rules) => Some(rules.to_vec()),
        None => Some(
            DEFAULT_ESLINT_SUPPRESSIONS
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
    }
}

/// The delimiter-stripped text of a comment (babel's `comment.value`): the chars
/// between `//` / `/*` and any closing `*/`. Used for the rule-name regex tests,
/// which match on `comment.value`.
fn comment_value<'a>(source: &'a str, comment: &Comment) -> &'a str {
    let start = comment.span.start as usize;
    let end = comment.span.end as usize;
    if end > source.len() || start >= end {
        return "";
    }
    let raw = &source[start..end];
    // Line: `// …`; Block: `/* … */`.
    let inner = raw
        .strip_prefix("//")
        .or_else(|| {
            raw.strip_prefix("/*")
                .map(|s| s.strip_suffix("*/").unwrap_or(s))
        })
        .unwrap_or(raw);
    inner
}

/// Whether `value` contains an `eslint-disable-next-line <rule>` directive for one
/// of `rules` (`Suppression.ts` `disableNextLinePattern`). Only the *first* matched
/// rule per comment matters (the regex has a single capture).
fn matches_disable_next_line(value: &str, rules: &[String]) -> bool {
    rule_after(value, "eslint-disable-next-line ", rules)
}

/// Whether `value` contains an `eslint-disable <rule>` directive (`disablePattern`).
fn matches_disable(value: &str, rules: &[String]) -> bool {
    rule_after(value, "eslint-disable ", rules)
}

/// Whether `value` contains an `eslint-enable <rule>` directive (`enablePattern`).
fn matches_enable(value: &str, rules: &[String]) -> bool {
    rule_after(value, "eslint-enable ", rules)
}

/// Whether `value` contains `<keyword><rule>` for some rule in `rules`. Ports the
/// TS `new RegExp(\`${keyword}(${rules.join('|')})\`)` test: the keyword (including
/// its trailing space) must be immediately followed by one of the rule names. The
/// regex is unanchored, so the directive may appear anywhere in the comment, and
/// `react-hooks/exhaustive-deps` matching as a *prefix* of a longer token is
/// possible (faithful to the un-anchored TS regex, which has no `\b` boundary).
fn rule_after(value: &str, keyword: &str, rules: &[String]) -> bool {
    if rules.is_empty() {
        return false;
    }
    let mut search_from = 0;
    while let Some(rel) = value[search_from..].find(keyword) {
        let after = &value[search_from + rel + keyword.len()..];
        if rules.iter().any(|r| after.starts_with(r.as_str())) {
            return true;
        }
        search_from += rel + keyword.len();
    }
    false
}

/// Whether `value` matches the Flow suppression pattern
/// `\$(FlowFixMe\w*|FlowExpectedError|FlowIssue)\[react\-rule` (`Suppression.ts`).
fn matches_flow(value: &str) -> bool {
    // Find `$` followed by one of the suppression keywords then `[react-rule`.
    let bytes = value;
    let mut from = 0;
    while let Some(rel) = bytes[from..].find('$') {
        let rest = &bytes[from + rel + 1..];
        let kw = if rest.starts_with("FlowFixMe") {
            // `FlowFixMe\w*` — consume the trailing word chars.
            let mut len = "FlowFixMe".len();
            for c in rest["FlowFixMe".len()..].chars() {
                if c.is_ascii_alphanumeric() || c == '_' {
                    len += c.len_utf8();
                } else {
                    break;
                }
            }
            Some(len)
        } else if rest.starts_with("FlowExpectedError") {
            Some("FlowExpectedError".len())
        } else if rest.starts_with("FlowIssue") {
            Some("FlowIssue".len())
        } else {
            None
        };
        if let Some(kw_len) = kw {
            if rest[kw_len..].starts_with("[react-rule") {
                return true;
            }
        }
        from += rel + 1;
    }
    false
}

/// Build the list of suppression ranges in `comments`, ported from
/// `findProgramSuppressions`. `rules` is the active eslint rule set
/// ([`suppression_rules`]); when `None`, eslint suppressions are not detected
/// (only Flow, if `flow_suppressions`). The single-pass state machine pairs a
/// pending `disable` comment with the next matching `enable` comment, exactly as
/// the TS does.
pub fn find_program_suppressions(
    source: &str,
    comments: &[Comment],
    rules: Option<&[String]>,
    flow_suppressions: bool,
) -> Vec<SuppressionRange> {
    let mut ranges = Vec::new();
    let mut disable: Option<(u32, u32)> = None;
    let mut enable: Option<(u32, u32)> = None;
    let mut source_kind: Option<SuppressionSource> = None;

    let eslint_active = rules.map(|r| !r.is_empty()).unwrap_or(false);
    let empty: Vec<String> = Vec::new();
    let rules = rules.unwrap_or(&empty);

    for comment in comments {
        let value = comment_value(source, comment);
        let span = (comment.span.start, comment.span.end);

        // `eslint-disable-next-line` only starts a range if we're not already in a
        // pending block (`disableComment == null`).
        if disable.is_none() && eslint_active && matches_disable_next_line(value, rules) {
            disable = Some(span);
            enable = Some(span);
            source_kind = Some(SuppressionSource::Eslint);
        }

        if flow_suppressions && disable.is_none() && matches_flow(value) {
            disable = Some(span);
            enable = Some(span);
            source_kind = Some(SuppressionSource::Flow);
        }

        if eslint_active && matches_disable(value, rules) {
            disable = Some(span);
            source_kind = Some(SuppressionSource::Eslint);
        }

        if eslint_active
            && matches_enable(value, rules)
            && source_kind == Some(SuppressionSource::Eslint)
        {
            enable = Some(span);
        }

        if let (Some(d), Some(src)) = (disable, source_kind) {
            ranges.push(SuppressionRange {
                disable: d,
                enable,
                source: src,
            });
            disable = None;
            enable = None;
            source_kind = None;
        }
    }
    ranges
}

/// The suppression ranges that affect a function spanning `[fn_start, fn_end)`,
/// ported from `filterSuppressionsThatAffectFunction`. A suppression affects the
/// function if it is *within* the function body, or if it *wraps* the function. A
/// disable block with no matching enable (`enable == disable`, i.e. an unclosed
/// `eslint-disable`) affects every subsequent function in the file.
pub fn filter_suppressions_that_affect_function(
    ranges: &[SuppressionRange],
    fn_start: u32,
    fn_end: u32,
) -> Vec<SuppressionRange> {
    let mut out = Vec::new();
    for range in ranges {
        let disable_start = range.disable.0;
        // `enableComment === null` ⇒ unclosed disable block: the rest of the file
        // has potential violations, so the bound check is skipped (the suppression
        // affects functions in both directions). A line comment / Flow suppression
        // has `enable == Some(disable)`, so the `enable.end` bound applies normally.
        //
        // within: disable.start > fn.start && (enable === null || enable.end < fn.end)
        let within = disable_start > fn_start
            && range.enable.map(|e| e.1 < fn_end).unwrap_or(true);
        // wraps: disable.start < fn.start && (enable === null || enable.end > fn.end)
        let wraps = disable_start < fn_start
            && range.enable.map(|e| e.1 > fn_end).unwrap_or(true);

        if within || wraps {
            out.push(*range);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc::allocator::Allocator;
    use oxc::parser::Parser;
    use oxc::span::SourceType;

    fn comments<'a>(allocator: &'a Allocator, src: &'a str) -> Vec<Comment> {
        Parser::new(allocator, src, SourceType::tsx())
            .parse()
            .program
            .comments
            .iter()
            .copied()
            .collect()
    }

    fn default_rules() -> Vec<String> {
        DEFAULT_ESLINT_SUPPRESSIONS
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn rules_gate_on_both_validations() {
        // Both validations on -> eslint suppressions ignored entirely.
        assert!(suppression_rules(true, true, None).is_none());
        // Either off -> default rule set active.
        assert_eq!(
            suppression_rules(false, true, None).as_deref(),
            Some(default_rules().as_slice())
        );
        assert_eq!(
            suppression_rules(true, false, None).as_deref(),
            Some(default_rules().as_slice())
        );
        // Explicit empty rule list overrides the default (the
        // `empty-eslint-suppressions-config` bug guard).
        assert_eq!(
            suppression_rules(false, true, Some(&[])).as_deref(),
            Some([].as_slice())
        );
    }

    #[test]
    fn unclosed_disable_block_affects_every_following_function() {
        let src = "\
/* eslint-disable react-hooks/rules-of-hooks */
function A() { return <div />; }
function B() { return <div />; }
";
        let allocator = Allocator::default();
        let cs = comments(&allocator, src);
        let ranges = find_program_suppressions(src, &cs, Some(&default_rules()), true);
        assert_eq!(ranges.len(), 1);
        assert!(ranges[0].enable.is_none(), "unclosed block ⇒ enable None");
        // Both A (starts at 47) and B (starts at 81) are after the disable comment
        // (which starts at 0) and the block is unclosed, so both are affected.
        let a_start = src.find("function A").unwrap() as u32;
        let a_end = src[a_start as usize..].find('}').unwrap() as u32 + a_start + 1;
        let b_start = src.find("function B").unwrap() as u32;
        let b_end = src[b_start as usize..].find('}').unwrap() as u32 + b_start + 1;
        assert_eq!(
            filter_suppressions_that_affect_function(&ranges, a_start, a_end).len(),
            1
        );
        assert_eq!(
            filter_suppressions_that_affect_function(&ranges, b_start, b_end).len(),
            1
        );
    }

    #[test]
    fn empty_rules_match_nothing() {
        let src = "// eslint-disable-next-line react-hooks/rules-of-hooks\nfn();\n";
        let allocator = Allocator::default();
        let cs = comments(&allocator, src);
        // Empty rule list: no eslint suppression is detected (no all-matching regexp).
        let ranges = find_program_suppressions(src, &cs, Some(&[]), true);
        assert!(ranges.is_empty());
    }

    #[test]
    fn unrelated_rule_not_matched() {
        let src = "// eslint-disable-next-line foo/not-react-related\nfn();\n";
        let allocator = Allocator::default();
        let cs = comments(&allocator, src);
        let ranges = find_program_suppressions(src, &cs, Some(&default_rules()), true);
        assert!(ranges.is_empty());
    }

    #[test]
    fn flow_suppression_detected_and_gated() {
        let src = "// $FlowFixMe[react-rule-hook]\nfn();\n";
        let allocator = Allocator::default();
        let cs = comments(&allocator, src);
        // flowSuppressions on (and not gated by eslint rule presence).
        let ranges = find_program_suppressions(src, &cs, None, true);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].source, SuppressionSource::Flow);
        // flowSuppressions off: not detected.
        let ranges = find_program_suppressions(src, &cs, None, false);
        assert!(ranges.is_empty());
    }

    #[test]
    fn disable_enable_across_comments_stays_unclosed() {
        // `findProgramSuppressions` pushes-and-resets at the END of the iteration
        // that sees the `eslint-disable` comment, with `enableComment` still null —
        // so a *separate* `eslint-enable` comment in a later iteration never pairs
        // (state was already reset). The disable block is therefore UNCLOSED and
        // affects every following function (verified against the oracle, which
        // leaves both `Inside` and `Outside` untouched).
        let src = "\
/* eslint-disable react-hooks/rules-of-hooks */
function Inside() { return <div />; }
/* eslint-enable react-hooks/rules-of-hooks */
function Outside() { return <div />; }
";
        let allocator = Allocator::default();
        let cs = comments(&allocator, src);
        let ranges = find_program_suppressions(src, &cs, Some(&default_rules()), true);
        assert_eq!(ranges.len(), 1);
        assert!(
            ranges[0].enable.is_none(),
            "the separate enable comment does not pair (immediate push-and-reset)"
        );
        let inside_start = src.find("function Inside").unwrap() as u32;
        let inside_end =
            src[inside_start as usize..].find('}').unwrap() as u32 + inside_start + 1;
        let outside_start = src.find("function Outside").unwrap() as u32;
        let outside_end =
            src[outside_start as usize..].find('}').unwrap() as u32 + outside_start + 1;
        // Both are affected (the unclosed block reaches the end of the file).
        assert_eq!(
            filter_suppressions_that_affect_function(&ranges, inside_start, inside_end).len(),
            1
        );
        assert_eq!(
            filter_suppressions_that_affect_function(&ranges, outside_start, outside_end).len(),
            1
        );
    }
}
