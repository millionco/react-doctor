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

  it("issue #302: exposes a `score` output and threads score opt-out into the score step", () => {
    const actionYaml = readActionYaml();
    const outputsBlock = extractBlock(actionYaml, "outputs:", "\nruns:");
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );
    const scoreStep = normalizeWhitespace(extractStep(actionYaml, "- id: score"));

    expect(inputsBlock).toContain("  no-score:");
    expect(inputsBlock).toContain('    default: "false"');
    expect(inputsBlock).not.toContain("  offline:");
    expect(outputsBlock).toContain("${{ steps.score.outputs.score }}");
    expect(scanStep).toContain(
      'if [ "${INPUT_NO_SCORE:-false}" = "true" ]; then FLAGS+=("--no-score"); fi',
    );
    expect(scoreStep).toContain("INPUT_NO_SCORE: ${{ inputs.no-score }}");
    expect(scoreStep).not.toContain("INPUT_OFFLINE");
    expect(scoreStep).toContain('if [ "${INPUT_NO_SCORE:-false}" = "true" ]; then exit 0; fi');
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
    const fetchStep = extractStep(readActionYaml(), "HEAD_REF: ${{ github.head_ref }}");

    expect(fetchStep).toContain('case "$DIFF_BASE" in -* )');
    expect(fetchStep).toContain('case "$HEAD_REF" in -* )');
    expect(fetchStep).toContain('git fetch origin "$DIFF_BASE"');
  });

  it("issue #527: defaults the diff base to the PR target branch on pull_request events", () => {
    const actionYaml = readActionYaml();

    // `inputs.diff || github.base_ref`: an explicit `diff` wins, otherwise
    // fall back to the PR's target branch (base_ref is set only on
    // pull_request events; empty on push -> full scan). Keeps PRs on a
    // diff scan so they never run the unbounded whole-project dead-code
    // pass that hangs large repos (issue #527).
    const resolvedDiff = "${{ inputs.diff || github.base_ref }}";
    const scanStep = extractStep(actionYaml, "INPUT_FAIL_ON: ${{ inputs.fail-on }}");
    const scoreStep = extractStep(actionYaml, "- id: score");
    const fetchStep = extractStep(actionYaml, "HEAD_REF: ${{ github.head_ref }}");

    expect(scanStep).toContain(`INPUT_DIFF: ${resolvedDiff}`);
    expect(scoreStep).toContain(`INPUT_DIFF: ${resolvedDiff}`);
    expect(fetchStep).toContain(`DIFF_BASE: ${resolvedDiff}`);
  });

  it("demotes design rules from the sticky PR comment via --pr-comment", () => {
    const scanStep = normalizeWhitespace(
      extractStep(readActionYaml(), "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );

    expect(scanStep).toContain('if [ -n "$INPUT_GITHUB_TOKEN" ]; then');
    expect(scanStep).toContain('"${FLAGS[@]}" --pr-comment | tee "$RAW_FILE"');
    expect(scanStep).toContain('PIPELINE_EXIT_CODES=("${PIPESTATUS[@]}")');
    expect(scanStep).toContain('sed -E \'/^::(error|warning) /d\' "$RAW_FILE" > "$OUTPUT_FILE"');
    expect(scanStep).toContain('exit "${PIPELINE_EXIT_CODES[0]}"');
    expect(scanStep).not.toContain('"${FLAGS[@]}" --pr-comment\n        else');
  });

  it("creates the sticky PR comment output before preserving scan failure", () => {
    const scanStep = normalizeWhitespace(
      extractStep(readActionYaml(), "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );
    const disableExitOnErrorIndex = scanStep.indexOf("set +e");
    const captureExitCodesIndex = scanStep.indexOf('PIPELINE_EXIT_CODES=("${PIPESTATUS[@]}")');
    const restoreExitOnErrorIndex = scanStep.indexOf("set -e", captureExitCodesIndex);
    const stripAnnotationsIndex = scanStep.indexOf(
      'sed -E \'/^::(error|warning) /d\' "$RAW_FILE" > "$OUTPUT_FILE"',
    );
    const restoreScanExitCodeIndex = scanStep.indexOf('exit "${PIPELINE_EXIT_CODES[0]}"');

    expect(disableExitOnErrorIndex).toBeGreaterThan(-1);
    expect(captureExitCodesIndex).toBeGreaterThan(disableExitOnErrorIndex);
    expect(restoreExitOnErrorIndex).toBeGreaterThan(captureExitCodesIndex);
    expect(stripAnnotationsIndex).toBeGreaterThan(restoreExitOnErrorIndex);
    expect(restoreScanExitCodeIndex).toBeGreaterThan(stripAnnotationsIndex);
  });

  it("issue #527: score step mirrors the scan's diff/project scope so it can't re-run a full scan", () => {
    const actionYaml = readActionYaml();
    const scoreStep = normalizeWhitespace(extractStep(actionYaml, "- id: score"));

    // Without these, a bare `--score` re-runs a FULL project scan even
    // when the scan step ran in `--diff` mode, re-triggering the
    // whole-project dead-code pass that diff mode skips and hanging the
    // job on large repos.
    expect(scoreStep).toContain("INPUT_PROJECT: ${{ inputs.project }}");
    expect(scoreStep).toContain(
      'if [ -n "$INPUT_DIFF" ]; then SCORE_ARGS+=("--diff" "$INPUT_DIFF"); fi',
    );
    expect(scoreStep).toContain(
      'if [ -n "$INPUT_PROJECT" ]; then SCORE_ARGS+=("--project" "$INPUT_PROJECT"); fi',
    );
  });

  it("forwards --annotations to the CLI when the annotations input is true", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );

    expect(inputsBlock).toContain("  annotations:");
    expect(scanStep).toContain("INPUT_ANNOTATIONS: ${{ inputs.annotations }}");
    expect(scanStep).toContain(
      'if [ "$INPUT_ANNOTATIONS" = "true" ]; then FLAGS+=("--annotations"); fi',
    );
  });
});
