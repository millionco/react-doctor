import type { OxlintJsonSummary } from "./types.ts";

export const parseOxlintJsonSummary = (output: string): OxlintJsonSummary => {
  const parsedOutput: unknown = JSON.parse(output);
  if (
    typeof parsedOutput !== "object" ||
    parsedOutput === null ||
    !("diagnostics" in parsedOutput) ||
    !Array.isArray(parsedOutput.diagnostics) ||
    !("number_of_files" in parsedOutput) ||
    typeof parsedOutput.number_of_files !== "number" ||
    !("number_of_rules" in parsedOutput) ||
    typeof parsedOutput.number_of_rules !== "number"
  ) {
    throw new Error("Oxlint returned an invalid JSON benchmark summary");
  }
  return {
    diagnosticCount: parsedOutput.diagnostics.length,
    fileCount: parsedOutput.number_of_files,
    ruleCount: parsedOutput.number_of_rules,
  };
};
