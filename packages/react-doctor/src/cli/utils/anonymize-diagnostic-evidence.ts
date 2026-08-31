import ts from "typescript";
import { RULE_EVIDENCE_MAX_TOKEN_COUNT } from "./constants.js";

export interface AnonymizedDiagnosticEvidence {
  readonly pattern: string;
  readonly tokenCount: number;
  readonly truncated: boolean;
}

export const anonymizeDiagnosticEvidence = (evidence: string): AnonymizedDiagnosticEvidence => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, evidence);
  const identifierIndexes = new Map<string, number>();
  const tokens: string[] = [];
  let tokenCount = 0;
  let tokenKind = scanner.scan();

  while (tokenKind !== ts.SyntaxKind.EndOfFileToken) {
    tokenCount += 1;
    if (tokens.length < RULE_EVIDENCE_MAX_TOKEN_COUNT) {
      let token: string;
      if (tokenKind === ts.SyntaxKind.Identifier || tokenKind === ts.SyntaxKind.PrivateIdentifier) {
        const identifier = scanner.getTokenText();
        const identifierIndex = identifierIndexes.get(identifier) ?? identifierIndexes.size + 1;
        identifierIndexes.set(identifier, identifierIndex);
        token = `identifier_${identifierIndex}`;
      } else if (
        tokenKind === ts.SyntaxKind.StringLiteral ||
        tokenKind === ts.SyntaxKind.JsxText ||
        tokenKind === ts.SyntaxKind.JsxTextAllWhiteSpaces
      ) {
        token = "string_literal";
      } else if (tokenKind === ts.SyntaxKind.NumericLiteral) {
        token = "number_literal";
      } else if (
        tokenKind === ts.SyntaxKind.TrueKeyword ||
        tokenKind === ts.SyntaxKind.FalseKeyword
      ) {
        token = "boolean_literal";
      } else if (tokenKind === ts.SyntaxKind.NullKeyword) {
        token = "null_literal";
      } else if (tokenKind === ts.SyntaxKind.BigIntLiteral) {
        token = "bigint_literal";
      } else if (tokenKind === ts.SyntaxKind.RegularExpressionLiteral) {
        token = "regular_expression_literal";
      } else if (
        tokenKind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        tokenKind === ts.SyntaxKind.TemplateHead ||
        tokenKind === ts.SyntaxKind.TemplateMiddle ||
        tokenKind === ts.SyntaxKind.TemplateTail
      ) {
        token = "template_literal";
      } else {
        token = ts.tokenToString(tokenKind) ?? `syntax_${tokenKind}`;
      }
      tokens.push(token);
    }
    tokenKind = scanner.scan();
  }

  return {
    pattern: tokens.join(" "),
    tokenCount,
    truncated: tokenCount > RULE_EVIDENCE_MAX_TOKEN_COUNT,
  };
};
