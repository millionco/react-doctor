import { isSameRuleKey, REACT_DOCTOR_RULE_KEY_PREFIX } from "./rule-key-aliases.js";
import { tokenizeRuleList } from "./tokenize-rule-list.js";

// `eslint-disable-*` / `oxlint-disable-*` are the "foreign" disable
// directives oxlint applies natively (react-doctor's own
// `react-doctor-disable-*` family is handled in evaluate-suppression).
// oxlint only matches a JS-plugin rule when the directive names it by its
// full `react-doctor/<id>` key — a bare short id (`no-eval`) or a legacy
// plugin-prefixed alias (`react/jsx-key`) silently fails to suppress. We
// can't change that matching, but when such a directive covers a *firing*
// react-doctor diagnostic we can tell the user to qualify it.

// Each pattern ends in a single greedy capture of the rest of the line
// (no trailing `$`-anchored whitespace groups) so there is no ambiguous
// backtracking on space-heavy input — `tokenizeRuleList` trims the leading
// whitespace, the ` -- description` tail, and any closing `*/` token. The
// `(?![\w-])` boundary keeps `eslint-disable-foo` and the `-line` /
// `-next-line` inline forms from matching the block directives.

// Inline directive, adjacent to the offending line. Captures: 1) the tool
// (`eslint` | `oxlint`), 2) the scope (`next-line` | `line`), 3) the rule list.
const FOREIGN_INLINE_DISABLE_PATTERN =
  /(?:\/\/|\/\*)[ \t]*(eslint|oxlint)-disable-(next-line|line)(?![\w-])([^\r\n]*)/;

// Block (range) directives: `/* eslint-disable rule */` opens a range that
// holds until a matching `/* eslint-enable rule */` (or end of file).
const FOREIGN_BLOCK_DISABLE_PATTERN = /\/\*[ \t]*(eslint|oxlint)-disable(?![\w-])([^*\r\n]*)/;
const FOREIGN_BLOCK_ENABLE_PATTERN = /\/\*[ \t]*(?:eslint|oxlint)-enable(?![\w-])([^*\r\n]*)/;

const buildHint = (tool: string, token: string, ruleId: string): string =>
  `oxlint matches plugin rules only by their full name, so \`${token}\` in your ${tool}-disable comment does not silence \`${ruleId}\` — change it to \`${ruleId}\`.`;

// A token names this rule but in a form oxlint can't bind to the plugin
// rule: a bare short id (`no-eval`) or a legacy plugin-prefixed alias
// (`react/jsx-key`). The canonical `react-doctor/<id>` is excluded —
// oxlint would have honored it, so the diagnostic wouldn't be firing.
const tokenMisnamesRule = (token: string, ruleId: string): boolean =>
  token !== ruleId && isSameRuleKey(token, ruleId);

const detectInlineNearMiss = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => {
  const candidates = [
    { line: lines[diagnosticLineIndex], requiredScope: "line" },
    { line: lines[diagnosticLineIndex - 1], requiredScope: "next-line" },
  ];

  for (const { line, requiredScope } of candidates) {
    const match = line?.match(FOREIGN_INLINE_DISABLE_PATTERN);
    if (!match) continue;
    const [, tool, scope, ruleList] = match;
    if (scope !== requiredScope) continue;
    const tokens = tokenizeRuleList(ruleList);
    // The canonical key alongside a misnamed alias means oxlint already
    // suppressed the rule — don't tell the user to add what's there.
    if (tokens.includes(ruleId)) continue;
    for (const token of tokens) {
      if (tokenMisnamesRule(token, ruleId)) return buildHint(tool, token, ruleId);
    }
  }
  return null;
};

const detectBlockNearMiss = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => {
  let openMisname: { tool: string; token: string } | null = null;
  const lastLineIndex = Math.min(diagnosticLineIndex, lines.length - 1);

  for (let lineIndex = 0; lineIndex <= lastLineIndex; lineIndex++) {
    const line = lines[lineIndex];
    if (line === undefined || (!line.includes("-disable") && !line.includes("-enable"))) continue;

    const disableMatch = line.match(FOREIGN_BLOCK_DISABLE_PATTERN);
    if (disableMatch) {
      const [, tool, ruleList] = disableMatch;
      const tokens = tokenizeRuleList(ruleList);
      // The canonical key (if listed) means oxlint already suppressed the
      // rule for this range; otherwise a misnamed token opens a near-miss.
      // A disable for unrelated rules leaves any open range untouched.
      if (tokens.includes(ruleId)) {
        openMisname = null;
      } else {
        const misnamed = tokens.find((token) => tokenMisnamesRule(token, ruleId));
        if (misnamed) openMisname = { tool, token: misnamed };
      }
      continue;
    }

    const enableMatch = line.match(FOREIGN_BLOCK_ENABLE_PATTERN);
    if (enableMatch) {
      const enabledRules = tokenizeRuleList(enableMatch[1]);
      // A bare `eslint-enable` (no rules) re-enables everything.
      if (enabledRules.length === 0 || enabledRules.some((rule) => isSameRuleKey(rule, ruleId))) {
        openMisname = null;
      }
    }
  }
  return openMisname ? buildHint(openMisname.tool, openMisname.token, ruleId) : null;
};

export const detectForeignDisableNearMiss = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => {
  if (!ruleId.startsWith(REACT_DOCTOR_RULE_KEY_PREFIX)) return null;
  return (
    detectInlineNearMiss(lines, diagnosticLineIndex, ruleId) ??
    detectBlockNearMiss(lines, diagnosticLineIndex, ruleId)
  );
};
