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
      "blocking",
      "comment",
      "review-comments",
      "commit-status",
      "node-version",
      "version",
    ]) {
      expect(inputsBlock).toContain(`  ${inputName}:`);
    }

    expect(inputsBlock).not.toContain("  github-token:");
    expect(inputsBlock).not.toContain("  verbose:");
    expect(inputsBlock).not.toContain("  no-score:");
    expect(inputsBlock).not.toContain("  diff:");
    // `fail-on` was renamed to `blocking`; `non-blocking` folds into its
    // `none` level; annotations were replaced by inline review comments.
    expect(inputsBlock).not.toContain("  fail-on:");
    expect(inputsBlock).not.toContain("  non-blocking:");
    expect(inputsBlock).not.toContain("  annotations:");
    expect(inputsBlock).toContain('    default: "true"');
    expect(inputsBlock).toContain('default: "*"');
    expect(inputsBlock).toContain('default: "24"');
    expect(inputsBlock).toContain('default: "error"');
    expect(outputsBlock).toContain("${{ steps.render.outputs.score }}");
    expect(outputsBlock).toContain("${{ steps.render.outputs.total-issues }}");
    expect(outputsBlock).toContain("${{ steps.render.outputs.affected-files }}");
  });

  it("collects PR changed files through the GitHub API instead of git ref checkout", () => {
    const actionYaml = readActionYaml();
    const prFilesStep = normalizeWhitespace(extractStep(actionYaml, "- id: pr-files"));

    // setup-node/github-script may be referenced by a floating major tag
    // (v5/v8) or pinned to a full-length commit SHA with a trailing version
    // comment — the form required by orgs that enforce GitHub's "actions pinned
    // to a full-length commit SHA" ruleset. Accept either so the composite
    // action stays consumable under those policies (and Dependabot can still
    // bump the pinned SHA), while keeping the major-version floor.
    expect(actionYaml).toMatch(/actions\/setup-node@(?:v5\b|[0-9a-f]{40} # v5\b)/);
    expect(actionYaml).toMatch(/actions\/github-script@(?:v8\b|[0-9a-f]{40} # v8\b)/);
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
    const actionYaml = readActionYaml();
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_PROJECT: ${{ inputs.project }}"),
    );

    expect(scanStep).toContain('FLAGS=("--json" "--json-compact")');
    expect(scanStep).not.toContain("--pr-comment");
    // The gate threshold is forwarded as `--blocking` (renamed from the
    // deprecated `--fail-on`); annotations were replaced by review comments.
    expect(actionYaml).not.toContain("--fail-on");
    expect(actionYaml).not.toContain("--annotations");
    expect(scanStep).toContain(
      'if [ -n "$INPUT_BLOCKING" ]; then FLAGS+=("--blocking" "$INPUT_BLOCKING"); fi',
    );
    expect(scanStep).toContain(
      'if [ -n "$INPUT_PROJECT" ]; then FLAGS+=("--project" "$INPUT_PROJECT"); fi',
    );
    expect(scanStep).toContain('FLAGS+=("--changed-files-from" "$CHANGED_FILES_FROM")');
    expect(scanStep).toContain(
      'npm exec --yes --package "$PACKAGE_SPEC" -- react-doctor "$INPUT_DIRECTORY" "${FLAGS[@]}" > "$REPORT_FILE"',
    );
    expect(scanStep).toContain('PACKAGE_SPEC="react-doctor@$INPUT_VERSION"');
    expect(scanStep).toContain("SCAN_STATUS=$?");
    expect(scanStep).toContain("scripts/ensure-json-report.mjs");
    expect(actionYaml).not.toContain("--score");
  });

  it("fetches the PR base commit and forwards it for baseline (new-vs-existing) mode", () => {
    const actionYaml = readActionYaml();
    const baseStep = normalizeWhitespace(extractStep(actionYaml, "- id: base"));
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_PROJECT: ${{ inputs.project }}"),
    );

    // The base commit is fetched so react-doctor can read base content + the
    // merge-base, and forwarded via REACT_DOCTOR_BASE_SHA (a branch name won't
    // resolve in a shallow PR checkout).
    expect(baseStep).toContain("github.event_name == 'pull_request'");
    expect(baseStep).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(baseStep).toContain(
      'git -C "$INPUT_DIRECTORY" fetch --no-tags --depth=1 origin "$BASE_SHA"',
    );
    expect(scanStep).toContain("REACT_DOCTOR_BASE_SHA: ${{ github.event.pull_request.base.sha }}");
  });

  it("posts inline review comments anchored to changed diff lines", () => {
    const actionYaml = readActionYaml();
    const reviewStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Post inline review comments"),
    );

    expect(reviewStep).toContain("inputs.review-comments == 'true'");
    expect(reviewStep).toContain("github.rest.pulls.listFiles");
    expect(reviewStep).toContain("github.rest.pulls.createReview");
    expect(reviewStep).toContain('event: "COMMENT"');
    expect(reviewStep).toContain('side: "RIGHT"');
    expect(reviewStep).toContain("github.rest.pulls.deleteReviewComment");
    expect(reviewStep).toContain("<!-- react-doctor:review -->");
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

  it("defaults blocking to error and propagates the CLI exit code", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const blockingInput = extractBlock(actionYaml, "  blocking:", "  comment:");
    const failStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Fail if React Doctor found blocking issues"),
    );

    expect(inputsBlock).toContain("  blocking:");
    expect(normalizeWhitespace(blockingInput)).toContain('default: "error"');
    // The gate lives in the CLI exit code now; the action just propagates it.
    expect(failStep).toContain('exit "${SCAN_STATUS:-1}"');
    expect(failStep).not.toContain("INPUT_NON_BLOCKING");
  });

  it("surfaces results on every event but only fails the run on pull requests", () => {
    const actionYaml = readActionYaml();
    const renderStep = normalizeWhitespace(extractStep(actionYaml, "- id: render"));
    const failStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Fail if React Doctor found blocking issues"),
    );

    // The rendered report is mirrored into the job summary so a push to the
    // default branch (no PR comment) still shows its result on the run page.
    expect(renderStep).toContain("GITHUB_STEP_SUMMARY");

    // Non-PR events (push to `main`) report findings but never fail the run, so
    // the default branch doesn't go red on pre-existing issues; PRs still
    // propagate the CLI exit code.
    expect(failStep).toContain("EVENT_NAME: ${{ github.event_name }}");
    expect(failStep).toContain('if [ "$EVENT_NAME" != "pull_request" ]; then exit 0');
    expect(failStep).toContain('exit "${SCAN_STATUS:-1}"');
  });

  it("publishes a commit status that carries the score and stays green on pushes", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const statusStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Publish commit status"),
    );

    expect(inputsBlock).toContain("  commit-status:");
    expect(statusStep).toContain("inputs.commit-status == 'true'");
    expect(statusStep).toContain("github.rest.repos.createCommitStatus");
    expect(statusStep).toContain('context: "React Doctor"');
    expect(statusStep).toContain("target_url:");
    expect(statusStep).toContain("Score: ${score}/100");
    // Advisory on push: only a PR whose scan failed posts a red (failure) status.
    expect(statusStep).toContain(
      'const state = isPullRequest && scanFailed ? "failure" : "success"',
    );
    // Missing `statuses: write` is a soft failure, not a crash.
    expect(statusStep).toContain("core.warning");
  });
});
