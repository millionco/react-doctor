// `eslint-disable-*` / `oxlint-disable-*` directive shapes shared by
// `detect-foreign-disable-near-miss` (hint when a react-doctor rule is
// misnamed) and `is-compiler-rule-foreign-disabled` (honor the documented
// `react-hooks/<rule>` spelling for React Compiler diagnostics).

// Each pattern ends in a single greedy capture of the rest of the line
// (no trailing `$`-anchored whitespace groups) so there is no ambiguous
// backtracking on space-heavy input — `tokenizeRuleList` trims the leading
// whitespace, the ` -- description` tail, and any closing `*/` token. The
// `(?![\w-])` boundary keeps `eslint-disable-foo` and the `-line` /
// `-next-line` inline forms from matching the block directives.

// Inline directive, adjacent to the offending line. Captures: 1) the tool
// (`eslint` | `oxlint`), 2) the scope (`next-line` | `line`), 3) the rule list.
export const FOREIGN_INLINE_DISABLE_PATTERN =
  /(?:\/\/|\/\*)[ \t]*(eslint|oxlint)-disable-(next-line|line)(?![\w-])([^\r\n]*)/;

// Block (range) directives: `/* eslint-disable rule */` opens a range that
// holds until a matching `/* eslint-enable rule */` (or end of file).
export const FOREIGN_BLOCK_DISABLE_PATTERN =
  /\/\*[ \t]*(eslint|oxlint)-disable(?![\w-])([^*\r\n]*)/;
export const FOREIGN_BLOCK_ENABLE_PATTERN =
  /\/\*[ \t]*(?:eslint|oxlint)-enable(?![\w-])([^*\r\n]*)/;
