import { REACT_COMPILER_BRIDGE_RULES } from "oxlint-plugin-react-doctor/core";
import type { OxlintDiagnostic } from "../../types/diagnostic.js";

const formatOxlintRuleCode = (ruleKey: string): string => {
  const separatorIndex = ruleKey.indexOf("/");
  return `${ruleKey.slice(0, separatorIndex)}(${ruleKey.slice(separatorIndex + 1)})`;
};

const bridgeRuleByCode = new Map(
  REACT_COMPILER_BRIDGE_RULES.map((bridgeRule) => [
    formatOxlintRuleCode(bridgeRule.key),
    bridgeRule,
  ]),
);

export const bridgeReactCompilerDiagnostic = (diagnostic: OxlintDiagnostic): OxlintDiagnostic => {
  const bridgeRule = bridgeRuleByCode.get(diagnostic.code);
  if (!bridgeRule) return diagnostic;
  return {
    ...diagnostic,
    code: formatOxlintRuleCode(bridgeRule.compilerKey),
    url: bridgeRule.compilerUrl,
  };
};
