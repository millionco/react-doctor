import {
  FOREIGN_BLOCK_DISABLE_PATTERN,
  FOREIGN_BLOCK_ENABLE_PATTERN,
  FOREIGN_INLINE_DISABLE_PATTERN,
} from "./foreign-disable-patterns.js";
import { tokenizeRuleList } from "./tokenize-rule-list.js";

// React Compiler diagnostics reach oxlint through the `react-hooks-js` JS
// plugin, so oxlint only binds a disable directive that spells the rule as
// `react-hooks-js/<rule>`. But eslint-plugin-react-hooks ships these same
// rules as `react-hooks/<rule>` — the spelling the React Compiler docs tell
// users to suppress with — so an existing, deliberate
// `// eslint-disable-next-line react-hooks/refs` silently fails to bind and
// the finding refires. Honor both spellings here (react-doctor's own
// `react-doctor-disable-*` family is handled in evaluate-suppression).
export const REACT_COMPILER_PLUGIN_PREFIX = "react-hooks-js/";
const ESLINT_REACT_HOOKS_PLUGIN_PREFIX = "react-hooks/";

const buildAcceptedTokens = (ruleId: string): ReadonlySet<string> => {
  const shortRuleId = ruleId.slice(REACT_COMPILER_PLUGIN_PREFIX.length);
  return new Set([ruleId, `${ESLINT_REACT_HOOKS_PLUGIN_PREFIX}${shortRuleId}`]);
};

const listNamesRule = (
  ruleList: string | undefined,
  acceptedTokens: ReadonlySet<string>,
): boolean => tokenizeRuleList(ruleList).some((token) => acceptedTokens.has(token));

const isInlineDisabled = (
  lines: string[],
  diagnosticLineIndex: number,
  acceptedTokens: ReadonlySet<string>,
): boolean => {
  const candidates = [
    { line: lines[diagnosticLineIndex], requiredScope: "line" },
    { line: lines[diagnosticLineIndex - 1], requiredScope: "next-line" },
  ];
  for (const { line, requiredScope } of candidates) {
    const match = line?.match(FOREIGN_INLINE_DISABLE_PATTERN);
    if (!match) continue;
    const [, , scope, ruleList] = match;
    if (scope !== requiredScope) continue;
    if (listNamesRule(ruleList, acceptedTokens)) return true;
  }
  return false;
};

const isBlockDisabled = (
  lines: string[],
  diagnosticLineIndex: number,
  acceptedTokens: ReadonlySet<string>,
): boolean => {
  let isRangeOpen = false;
  const lastLineIndex = Math.min(diagnosticLineIndex, lines.length - 1);

  for (let lineIndex = 0; lineIndex <= lastLineIndex; lineIndex++) {
    const line = lines[lineIndex];
    if (line === undefined || (!line.includes("-disable") && !line.includes("-enable"))) continue;

    const disableMatch = line.match(FOREIGN_BLOCK_DISABLE_PATTERN);
    if (disableMatch && listNamesRule(disableMatch[2], acceptedTokens)) {
      isRangeOpen = true;
      continue;
    }

    const enableMatch = line.match(FOREIGN_BLOCK_ENABLE_PATTERN);
    if (enableMatch) {
      const enabledRules = tokenizeRuleList(enableMatch[1]);
      // A bare `eslint-enable` (no rules) re-enables everything.
      if (enabledRules.length === 0 || enabledRules.some((rule) => acceptedTokens.has(rule))) {
        isRangeOpen = false;
      }
    }
  }
  return isRangeOpen;
};

export const isCompilerRuleForeignDisabled = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): boolean => {
  if (!ruleId.startsWith(REACT_COMPILER_PLUGIN_PREFIX)) return false;
  const acceptedTokens = buildAcceptedTokens(ruleId);
  return (
    isInlineDisabled(lines, diagnosticLineIndex, acceptedTokens) ||
    isBlockDisabled(lines, diagnosticLineIndex, acceptedTokens)
  );
};
