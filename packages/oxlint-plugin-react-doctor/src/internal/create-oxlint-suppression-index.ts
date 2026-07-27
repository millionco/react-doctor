import type { Comment } from "oxc-parser";
import { getSourcePosition } from "./get-source-position.js";

interface OxlintSuppressionIndex {
  readonly isSuppressed: (ruleId: string, sourceStart: number, sourceEnd: number) => boolean;
}

interface OxlintSuppressionDirective {
  readonly action: "disable" | "enable";
  readonly scope: "region" | "line" | "next-line";
  readonly rules: ReadonlySet<string> | null;
  readonly comment: Comment;
  readonly startLine: number;
  readonly endLine: number;
}

interface CreateOxlintSuppressionIndexInput {
  readonly sourceText: string;
  readonly comments: ReadonlyArray<Comment>;
}

const DIRECTIVE_PATTERN =
  /^\s*(?:eslint|oxlint)-(disable-next-line|disable-line|disable|enable)\b([\s\S]*)$/;
const DESCRIPTION_SEPARATOR_PATTERN = /\s+--(?:\s|$)/;
const RULE_SEPARATOR_PATTERN = /[\s,]+/;

const parseRules = (ruleListText: string): ReadonlySet<string> | null => {
  const ruleSegment = ruleListText.split(DESCRIPTION_SEPARATOR_PATTERN, 1)[0]?.trim() ?? "";
  if (ruleSegment.length === 0) return null;
  return new Set(ruleSegment.split(RULE_SEPARATOR_PATTERN).filter(Boolean));
};

const parseDirective = (
  sourceText: string,
  comment: Comment,
): OxlintSuppressionDirective | null => {
  const match = DIRECTIVE_PATTERN.exec(comment.value);
  if (!match) return null;
  const directiveKind = match[1];
  if (!directiveKind) return null;
  const action = directiveKind === "enable" ? "enable" : "disable";
  let scope: OxlintSuppressionDirective["scope"] = "region";
  if (directiveKind === "disable-line") scope = "line";
  if (directiveKind === "disable-next-line") scope = "next-line";
  return {
    action,
    scope,
    rules: parseRules(match[2] ?? ""),
    comment,
    startLine: getSourcePosition(sourceText, comment.start).line,
    endLine: getSourcePosition(sourceText, comment.end).line,
  };
};

const namesRule = (directive: OxlintSuppressionDirective, ruleId: string): boolean =>
  directive.rules === null || directive.rules.has(`react-doctor/${ruleId}`);

const hasUnboundedNextLineBoundary = (sourceText: string, comment: Comment): boolean => {
  if (comment.type !== "Line") return false;
  const boundaryCharacter = sourceText[comment.end];
  // HACK: Oxlint 1.74 suppresses the rest of the file when a line directive
  // ends at a lone CR, U+2028, or U+2029 instead of LF or CRLF.
  return (
    boundaryCharacter === "\u2028" ||
    boundaryCharacter === "\u2029" ||
    (boundaryCharacter === "\r" && sourceText[comment.end + 1] !== "\n")
  );
};

const isRegionSuppressed = (
  directives: ReadonlyArray<OxlintSuppressionDirective>,
  ruleId: string,
  sourceStart: number,
  sourceEnd: number,
): boolean => {
  let intervalStart = 0;
  let isGloballyDisabled = false;
  let isRuleDisabled = false;
  for (const directive of directives) {
    if (directive.scope !== "region") continue;
    if (
      (isGloballyDisabled || isRuleDisabled) &&
      intervalStart < sourceEnd &&
      directive.comment.end > sourceStart
    ) {
      return true;
    }
    intervalStart = directive.comment.end;
    if (directive.rules === null) {
      isGloballyDisabled = directive.action === "disable";
    } else if (namesRule(directive, ruleId)) {
      isRuleDisabled = directive.action === "disable";
    }
  }
  return (isGloballyDisabled || isRuleDisabled) && intervalStart < sourceEnd;
};

export const createOxlintSuppressionIndex = (
  input: CreateOxlintSuppressionIndexInput,
): OxlintSuppressionIndex => {
  const directives = input.comments
    .map((comment) => parseDirective(input.sourceText, comment))
    .filter((directive): directive is OxlintSuppressionDirective => directive !== null);

  return {
    isSuppressed: (ruleId, sourceStart, sourceEnd) => {
      const diagnosticStartLine = getSourcePosition(input.sourceText, sourceStart).line;
      for (const directive of directives) {
        if (!namesRule(directive, ruleId)) continue;
        if (
          directive.scope === "line" &&
          diagnosticStartLine === directive.startLine &&
          sourceStart < directive.comment.start
        ) {
          return true;
        }
        if (
          directive.scope === "next-line" &&
          ((hasUnboundedNextLineBoundary(input.sourceText, directive.comment) &&
            sourceStart >= directive.comment.end) ||
            diagnosticStartLine === directive.endLine + 1 ||
            (directive.comment.type === "Block" &&
              diagnosticStartLine === directive.endLine &&
              sourceStart >= directive.comment.end))
        ) {
          return true;
        }
      }
      return isRegionSuppressed(directives, ruleId, sourceStart, sourceEnd);
    },
  };
};
