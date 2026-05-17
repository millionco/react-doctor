import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ACTION_YAML_PATH = path.join(REPOSITORY_ROOT, "action.yml");

const readActionYaml = (): string => fs.readFileSync(ACTION_YAML_PATH, "utf8");
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ");

const extractBlock = (actionYaml: string, startMarker: string, endMarker: string): string => {
  const startIndex = actionYaml.indexOf(startMarker);
  if (startIndex < 0) throw new Error(`Missing action.yml marker: ${startMarker}`);
  const endIndex = actionYaml.indexOf(endMarker, startIndex + startMarker.length);
  if (endIndex < 0) throw new Error(`Missing action.yml marker: ${endMarker}`);
  return actionYaml.slice(startIndex, endIndex);
};

const extractStep = (actionYaml: string, marker: string): string => {
  const markerIndex = actionYaml.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing action.yml step marker: ${marker}`);
  const stepStartIndex = actionYaml.lastIndexOf("\n    - ", markerIndex);
  const stepEndIndex = actionYaml.indexOf("\n    - ", markerIndex + marker.length);
  return actionYaml.slice(
    stepStartIndex < 0 ? 0 : stepStartIndex,
    stepEndIndex < 0 ? undefined : stepEndIndex,
  );
};

describe("GitHub Action contract", () => {
  it("issue #190: score collection cannot fail the job on Needs work scores", () => {
    const scoreStep = normalizeWhitespace(extractStep(readActionYaml(), "- id: score"));

    expect(scoreStep).toContain("--score");
    expect(scoreStep).toContain('"--fail-on" "none"');
    expect(scoreStep).toContain("SCORE=$(npx react-doctor@latest");
    expect(scoreStep).toContain("|| true");
  });

  it("issue #188 + #61: action exposes CI inputs used by the scan step", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );

    for (const inputName of ["github-token", "fail-on", "diff"]) {
      expect(inputsBlock).toContain(`  ${inputName}:`);
    }
    expect(scanStep).toContain('"--fail-on" "$INPUT_FAIL_ON"');
    expect(scanStep).toContain('"--diff" "$INPUT_DIFF"');
    expect(scanStep).toContain("$INPUT_GITHUB_TOKEN");
  });

  it("guards diff fetch refs against shell-option injection", () => {
    const fetchStep = extractStep(readActionYaml(), "DIFF_BASE: ${{ inputs.diff }}");

    expect(fetchStep).toContain('case "$DIFF_BASE" in -* )');
    expect(fetchStep).toContain('case "$HEAD_REF" in -* )');
    expect(fetchStep).toContain('git fetch origin "$DIFF_BASE"');
  });

  it("demotes design rules from the sticky PR comment via --pr-comment", () => {
    const scanStep = normalizeWhitespace(
      extractStep(readActionYaml(), "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );

    expect(scanStep).toContain('if [ -n "$INPUT_GITHUB_TOKEN" ]; then');
    expect(scanStep).toContain('"${FLAGS[@]}" --pr-comment | tee "$OUTPUT_FILE"');
    expect(scanStep).not.toContain('"${FLAGS[@]}" --pr-comment\n        else');
  });
});
