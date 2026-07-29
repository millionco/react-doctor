import { executeRule } from "../internal/execute-rule.js";
import type {
  ExecutedRuleDiagnostic,
  ExecuteRuleOptions,
  ExecuteRuleResult,
} from "../internal/execute-rule.js";
import { parseFixture } from "./parse-fixture.js";
import type { ParseFixtureResult } from "./parse-fixture.js";
import type { Rule } from "../plugin/utils/rule.js";

export interface RunRuleOptions extends ExecuteRuleOptions {}

export interface RuleDiagnostic {
  readonly message: string;
  readonly nodeType: string;
}

export interface CapturedRuleDiagnostic extends ExecutedRuleDiagnostic {}

export interface RunRuleResult {
  readonly diagnostics: RuleDiagnostic[];
  readonly parseErrors: ReadonlyArray<{ readonly message: string }>;
}

export const executeRuleOnParsedFixture = (
  rule: Rule,
  sourceText: string,
  parsedSource: ParseFixtureResult,
  options: RunRuleOptions = {},
): ExecuteRuleResult => executeRule(rule, sourceText, parsedSource, options);

export const runRuleOnParsedFixture = (
  rule: Rule,
  code: string,
  parsed: ParseFixtureResult,
  options: RunRuleOptions = {},
): RunRuleResult => {
  const result = executeRuleOnParsedFixture(rule, code, parsed, options);
  return {
    diagnostics: result.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      nodeType: diagnostic.node.type,
    })),
    parseErrors: result.parseErrors,
  };
};

export const runRule = (rule: Rule, code: string, options: RunRuleOptions = {}): RunRuleResult => {
  const parsed = parseFixture(code, {
    filename: options.filename,
    forceJsx: options.forceJsx,
  });
  return runRuleOnParsedFixture(rule, code, parsed, options);
};
