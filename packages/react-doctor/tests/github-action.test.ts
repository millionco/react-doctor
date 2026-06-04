import * as fs from "node:fs";
import * as path from "node:path";
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
  it("exposes the low-config public inputs and useful JSON-derived outputs", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const outputsBlock = extractBlock(actionYaml, "outputs:", "\nruns:");

    for (const inputName of [
      "directory",
      "project",
      "fail-on",
      "comment",
      "annotations",
      "node-version",
      "version",
    ]) {
      expect(inputsBlock).toContain(`  ${inputName}:`);
    }

    expect(inputsBlock).not.toContain("  github-token:");
    expect(inputsBlock).not.toContain("  verbose:");
    expect(inputsBlock).not.toContain("  no-score:");
    expect(inputsBlock).not.toContain("  diff:");
    expect(inputsBlock).toContain('    default: "true"');
    expect(outputsBlock).toContain("${{ steps.render.outputs.score }}");
    expect(outputsBlock).toContain("${{ steps.render.outputs.total-issues }}");
    expect(outputsBlock).toContain("${{ steps.render.outputs.affected-files }}");
  });

  it("collects PR changed files through the GitHub API instead of git ref checkout", () => {
    const actionYaml = readActionYaml();
    const prFilesStep = normalizeWhitespace(extractStep(actionYaml, "- id: pr-files"));

    expect(actionYaml).toContain("actions/setup-node@v5");
    expect(actionYaml).toContain("actions/github-script@v8");
    expect(actionYaml).not.toContain("actions/setup-node@v4");
    expect(actionYaml).not.toContain("actions/github-script@v7");
    expect(prFilesStep).toContain("github.rest.pulls.listFiles");
    expect(prFilesStep).toContain('new Set(["added", "modified", "renamed"])');
    expect(prFilesStep).toContain(".map((file) => file.filename);");
    expect(prFilesStep).toContain('core.setOutput("path", outputPath)');
    expect(prFilesStep).not.toContain("filename)h");
    expect(actionYaml).not.toContain("git fetch origin");
    expect(actionYaml).not.toContain('git checkout "$HEAD_REF"');
  });

  it("falls back to a full-project scan when listing PR files is not permitted", () => {
    const prFilesStep = normalizeWhitespace(extractStep(readActionYaml(), "- id: pr-files"));

    expect(prFilesStep).toContain("try {");
    expect(prFilesStep).toContain("} catch (error) {");
    expect(prFilesStep).toContain("core.warning(");
    expect(prFilesStep).toContain("pull-requests: read");

    const catchIndex = prFilesStep.indexOf("} catch (error) {");
    const returnIndex = prFilesStep.indexOf("return;", catchIndex);
    const setOutputIndex = prFilesStep.indexOf('core.setOutput("path", outputPath)');

    expect(catchIndex).toBeGreaterThan(-1);
    expect(returnIndex).toBeGreaterThan(catchIndex);
    expect(returnIndex).toBeLessThan(setOutputIndex);
  });

  it("runs one JSON scan, captures its status, and passes PR files to the CLI", () => {
    const scanStep = normalizeWhitespace(
      extractStep(readActionYaml(), "INPUT_FAIL_ON: ${{ inputs.fail-on }}"),
    );

    expect(scanStep).toContain('"--json" "--json-compact" "--fail-on" "$INPUT_FAIL_ON"');
    expect(scanStep).not.toContain("--pr-comment");
    expect(scanStep).toContain(
      'if [ "$INPUT_ANNOTATIONS" = "true" ]; then FLAGS+=("--annotations"); fi',
    );
    expect(scanStep).toContain('FLAGS+=("--changed-files-from" "$CHANGED_FILES_FROM")');
    expect(scanStep).toContain(
      'npm exec --yes --package "$PACKAGE_SPEC" -- react-doctor "$INPUT_DIRECTORY" "${FLAGS[@]}" > "$REPORT_FILE"',
    );
    expect(scanStep).toContain('PACKAGE_SPEC="react-doctor@$INPUT_VERSION"');
    expect(scanStep).toContain("SCAN_STATUS=$?");
    expect(scanStep).toContain("scripts/ensure-json-report.mjs");
    expect(readActionYaml()).not.toContain("--score");
  });

  it("renders and posts the sticky comment before restoring scan failure", () => {
    const actionYaml = readActionYaml();
    const renderIndex = actionYaml.indexOf("- id: render");
    const commentIndex = actionYaml.indexOf("- name: Update sticky PR comment");
    const failIndex = actionYaml.indexOf("- name: Fail if React Doctor found blocking issues");
    const commentStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Update sticky PR comment"),
    );

    expect(renderIndex).toBeGreaterThan(-1);
    expect(commentIndex).toBeGreaterThan(renderIndex);
    expect(failIndex).toBeGreaterThan(commentIndex);
    expect(commentStep).toContain("<!-- react-doctor:summary -->");
    expect(commentStep).toContain("github.rest.issues.updateComment");
    expect(commentStep).toContain("github.rest.issues.createComment");
    expect(commentStep).toContain("core.warning");
  });

  it("non-blocking input makes the fail gate always exit 0", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const nonBlockingInput = extractBlock(actionYaml, "  non-blocking:", "  comment:");
    const failStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Fail if React Doctor found blocking issues"),
    );

    expect(inputsBlock).toContain("  non-blocking:");
    expect(normalizeWhitespace(nonBlockingInput)).toContain('default: "false"');
    expect(failStep).toContain("INPUT_NON_BLOCKING: ${{ inputs.non-blocking }}");
    expect(failStep).toContain('if [ "$INPUT_NON_BLOCKING" = "true" ]; then');
    expect(failStep).toContain("exit 0");
    expect(failStep).toContain('exit "$SCAN_STATUS"');
  });
});
