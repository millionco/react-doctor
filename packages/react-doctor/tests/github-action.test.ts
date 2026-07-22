import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ACTION_YAML_PATH = path.join(REPOSITORY_ROOT, "action.yml");

const readActionYaml = (): string => fs.readFileSync(ACTION_YAML_PATH, "utf8");
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ");

// Neutral git identity + config so the fixture commits below can't hang on a
// developer's global `commit.gpgsign` (no TTY for the passphrase prompt).
const GIT_TEST_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "react-doctor-test",
  GIT_AUTHOR_EMAIL: "test@react.doctor",
  GIT_COMMITTER_NAME: "react-doctor-test",
  GIT_COMMITTER_EMAIL: "test@react.doctor",
};

const runGit = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, env: GIT_TEST_ENV, encoding: "utf8" }).trim();

const BASE_STEP_RUN_MARKER = "run: |\n";

const extractBaseStepScript = (actionYaml: string): string => {
  const baseStep = extractStep(actionYaml, "- id: base");
  const runIndex = baseStep.indexOf(BASE_STEP_RUN_MARKER);
  if (runIndex < 0) throw new Error("Missing run block on the base step");
  const scriptLines: string[] = [];
  for (const rawLine of baseStep.slice(runIndex + BASE_STEP_RUN_MARKER.length).split("\n")) {
    // The block scalar ends at the first line shallower than its 8-space body
    // indent (extractStep keeps trailing step-level comments that would
    // dedent into broken bash).
    if (rawLine.trim() !== "" && !rawLine.startsWith("        ")) break;
    scriptLines.push(rawLine.slice(8));
  }
  return scriptLines.join("\n");
};

// The fixture spawns bash + git; Windows runners route through Git Bash where
// file:// shallow transport quirks make this flaky, and CI covers it on the
// POSIX legs.
const itOnPosix = process.platform === "win32" ? it.skip : it;

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
    expect(inputsBlock).toContain('default: "none"');
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
    expect(prFilesStep).toContain(".map((file) => file.filename)");
    expect(prFilesStep).toContain('core.setOutput("path", outputPath)');
    expect(prFilesStep).not.toContain("filename)h");
    expect(actionYaml).not.toContain("git fetch origin");
    expect(actionYaml).not.toContain('git checkout "$HEAD_REF"');
  });

  it("derives changed files (local git diff first, API fallback) via the shared scan-relative normalizer", () => {
    const actionYaml = readActionYaml();
    const baseStep = normalizeWhitespace(extractStep(actionYaml, "- id: base"));
    const prFilesStep = normalizeWhitespace(extractStep(actionYaml, "- id: pr-files"));

    // The repo-root → scan-relative prefix-stripping (strip the `directory`
    // prefix, drop files outside it, so `directory: UI` doesn't double up to
    // `UI/UI/src/...` and miss every base read — issue #858) now lives in the
    // shared scripts/normalize-changed-files.mjs and is unit-tested there. The
    // action delegates to it from BOTH the local-diff base step and the API
    // fallback, which only runs when the base wasn't reachable for a local diff.
    expect(baseStep).toContain('git -C "$INPUT_DIRECTORY" diff --name-only --diff-filter=AMR');
    expect(baseStep).toContain("scripts/normalize-changed-files.mjs");
    // The strip prefix comes from git (`rev-parse --show-prefix`), not the raw
    // `directory` input, and the API fallback reuses the derived prefix — the
    // full rationale lives on the `base` step in action.yml. Each locked line
    // is load-bearing: dropping the `prefix=` output write or the `.` sentinel
    // silently reverts to the raw input via the GHA `||` fallback, and the
    // newline guard is what keeps a hostile directory name out of
    // $GITHUB_OUTPUT's line protocol.
    expect(baseStep).toContain("rev-parse --show-prefix");
    expect(baseStep).toContain('SCAN_PREFIX="${SCAN_PREFIX:-.}"');
    expect(baseStep).toContain('else SCAN_PREFIX="$INPUT_DIRECTORY"');
    expect(baseStep).toContain("*$'\\n'*) SCAN_PREFIX=\".\" ;;");
    expect(baseStep).toContain('echo "prefix=$SCAN_PREFIX" >> "$GITHUB_OUTPUT"');
    expect(baseStep).toContain(
      'node "$GITHUB_ACTION_PATH/scripts/normalize-changed-files.mjs" "$SCAN_PREFIX"',
    );
    expect(prFilesStep).toContain(
      "INPUT_DIRECTORY: ${{ steps.base.outputs.prefix || inputs.directory }}",
    );
    expect(prFilesStep).toContain("scripts/normalize-changed-files.mjs");
    expect(prFilesStep).toContain("normalizeChangedFiles(");
    expect(prFilesStep).toContain("steps.base.outputs.path == ''");
    // Inside the nested github-script step, `GITHUB_ACTION_PATH` resolves to
    // github-script's own dir — the composite path is forwarded explicitly so
    // the shared script import resolves. Lock that it reads the forwarded var.
    expect(prFilesStep).toContain("COMPOSITE_ACTION_PATH: ${{ github.action_path }}");
    expect(prFilesStep).toContain("process.env.COMPOSITE_ACTION_PATH");
    expect(prFilesStep).not.toContain("process.env.GITHUB_ACTION_PATH");
  });

  // Executes the REAL base-step shell against a fixture mimicking
  // actions/checkout's default `fetch-depth: 1` pull_request checkout: a
  // shallow-grafted merge-ref HEAD, where the three-dot diff has no merge
  // base. Locks the shallow-checkout contract end to end: the git-derived
  // prefix is still emitted (the API fallback consumes it), the changed-files
  // file stays unwritten, and the ::warning points consumers at
  // `fetch-depth: 0` — the scaffolded setup, which the baseline compare needs
  // anyway. There is deliberately NO local-diff fast path for shallow
  // checkouts (a two-dot variant was dropped in favor of scaffolding
  // `fetch-depth: 0`).
  itOnPosix(
    "defers to the API fallback on a fetch-depth:1 merge-ref checkout while still emitting the prefix",
    () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-action-base-"));
      try {
        const originDirectory = path.join(fixtureRoot, "origin");
        const checkoutDirectory = path.join(fixtureRoot, "checkout");
        const runnerTemp = path.join(fixtureRoot, "runner-temp");
        fs.mkdirSync(originDirectory);
        fs.mkdirSync(checkoutDirectory);
        fs.mkdirSync(runnerTemp);

        runGit(originDirectory, "init", "--initial-branch=main");
        // GitHub's upload-pack allows fetching the event's base SHA directly;
        // the local fixture needs the same for the base step's best-effort fetch.
        runGit(originDirectory, "config", "uploadpack.allowAnySHA1InWant", "true");
        fs.mkdirSync(path.join(originDirectory, "src"));
        fs.writeFileSync(
          path.join(originDirectory, "src", "app.tsx"),
          "export const App = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "base");
        const baseSha = runGit(originDirectory, "rev-parse", "HEAD");
        runGit(originDirectory, "checkout", "-b", "pr");
        fs.writeFileSync(
          path.join(originDirectory, "src", "feature.tsx"),
          "export const Feature = () => null;\n",
        );
        runGit(originDirectory, "add", ".");
        runGit(originDirectory, "-c", "commit.gpgsign=false", "commit", "-m", "feature");
        // refs/pull/N/merge: a merge commit whose FIRST parent is the base tip.
        runGit(originDirectory, "-c", "advice.detachedHead=false", "checkout", "--detach", "main");
        runGit(
          originDirectory,
          "-c",
          "commit.gpgsign=false",
          "merge",
          "--no-ff",
          "pr",
          "-m",
          "merge pr into main",
        );
        runGit(originDirectory, "update-ref", "refs/pull/1/merge", "HEAD");

        runGit(checkoutDirectory, "init");
        runGit(checkoutDirectory, "remote", "add", "origin", pathToFileURL(originDirectory).href);
        runGit(
          checkoutDirectory,
          "fetch",
          "--depth=1",
          "origin",
          "+refs/pull/1/merge:refs/remotes/pull/1/merge",
        );
        runGit(
          checkoutDirectory,
          "-c",
          "advice.detachedHead=false",
          "checkout",
          "--force",
          "refs/remotes/pull/1/merge",
        );

        const changedFilesFile = path.join(runnerTemp, "react-doctor-changed-files.txt");
        const githubOutputFile = path.join(runnerTemp, "github-output.txt");
        fs.writeFileSync(githubOutputFile, "");
        // Match the composite `shell: bash` invocation (errexit + pipefail).
        const scriptOutput = execFileSync(
          "bash",
          [
            "--noprofile",
            "--norc",
            "-e",
            "-o",
            "pipefail",
            "-c",
            extractBaseStepScript(readActionYaml()),
          ],
          {
            cwd: checkoutDirectory,
            encoding: "utf8",
            env: {
              ...GIT_TEST_ENV,
              INPUT_DIRECTORY: ".",
              BASE_SHA: baseSha,
              CHANGED_FILES_FILE: changedFilesFile,
              RUNNER_TEMP: runnerTemp,
              GITHUB_OUTPUT: githubOutputFile,
              GITHUB_ACTION_PATH: REPOSITORY_ROOT,
            },
          },
        );

        expect(scriptOutput).toContain(
          "::warning::React Doctor could not derive the PR's changed files from git",
        );
        expect(scriptOutput).toContain("fetch-depth: 0");
        expect(fs.existsSync(changedFilesFile)).toBe(false);
        const githubOutput = fs.readFileSync(githubOutputFile, "utf8");
        expect(githubOutput).toContain("prefix=.");
        expect(githubOutput).not.toContain("path=");
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    30_000,
  );

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
    // PACKAGE_SPEC is resolved once (and made cacheable) by the resolve-version
    // step and read from its output, not derived inline in the scan step.
    expect(scanStep).toContain("PACKAGE_SPEC: ${{ steps.resolve-version.outputs.spec }}");
    expect(scanStep).toContain("SCAN_STATUS=$?");
    expect(scanStep).toContain("scripts/ensure-json-report.mjs");
    expect(actionYaml).not.toContain("--score");
  });

  it("resolves the version once and caches the install + persistent scan caches", () => {
    const actionYaml = readActionYaml();
    const resolveStep = normalizeWhitespace(extractStep(actionYaml, "- id: resolve-version"));
    const scanStep = normalizeWhitespace(
      extractStep(actionYaml, "INPUT_PROJECT: ${{ inputs.project }}"),
    );

    // resolve-version pins the version so the install cache key is stable even
    // for `latest`; actions/cache (SHA-pinned or floating) restores the toolchain
    // install + the persistent scan caches; the scan installs into the cached
    // prefix on a published version and runs the local binary, falling back to
    // npx for a local-path spec.
    expect(resolveStep).toContain("scripts/resolve-package-spec.mjs");
    expect(actionYaml).toMatch(/actions\/cache@(?:v6\.1\.0\b|[0-9a-f]{40} # v6\.1\.0\b)/);
    expect(actionYaml).toContain("react-doctor-toolchain");
    expect(actionYaml).toContain("react-doctor-scan-cache-");
    expect(scanStep).toContain('npm install --prefix "$TOOLCHAIN_DIR"');
    expect(scanStep).toContain('"$RD_BIN" "$INPUT_DIRECTORY" "${FLAGS[@]}" > "$REPORT_FILE"');
    expect(scanStep).toContain("REACT_DOCTOR_CACHE_DIR: ${{ runner.temp }}/react-doctor-cache");
    // A cache-miss install runs under `set +e` and the toolchain is adopted
    // only when the bin actually RUNS (`--version`), not merely exists — npm
    // treats optionalDependency failures (the oxlint platform binding) as
    // non-fatal, so exit 0 can leave a linked-but-broken bin. A failed probe
    // wipes the dir so the post-job cache save can't persist the poison under
    // the immutable version key, and the scan falls through to the npx path.
    expect(scanStep).toContain(
      'if ! "$TOOLCHAIN_DIR/node_modules/.bin/react-doctor" --version >/dev/null 2>&1; then',
    );
    expect(scanStep).toContain(
      'if "$TOOLCHAIN_DIR/node_modules/.bin/react-doctor" --version >/dev/null 2>&1; then',
    );
    expect(scanStep).toContain('RD_BIN="$TOOLCHAIN_DIR/node_modules/.bin/react-doctor"');
    expect(scanStep).toContain('else rm -rf "$TOOLCHAIN_DIR"');
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
    // The fetch is best-effort (`|| true`) and the local diff is gated only on
    // the base SHA, NOT on a fetch-succeeded flag — the base may already be in
    // history (e.g. `fetch-depth: 0`), where the old FETCHED gate wrongly fell
    // through to the API. The diff itself stays guarded against shallow misses.
    expect(baseStep).toContain('origin "$BASE_SHA" 2>/dev/null || true');
    expect(baseStep).not.toContain("FETCHED");
    expect(scanStep).toContain("REACT_DOCTOR_BASE_SHA: ${{ github.event.pull_request.base.sha }}");
  });

  it("posts inline review comments anchored to changed diff lines", () => {
    const actionYaml = readActionYaml();
    const reviewStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Post inline review comments"),
    );

    expect(reviewStep).toContain("inputs.review-comments == 'true'");
    // The inline-comment path mapping uses the same git-derived scan prefix as
    // the changed-files steps; the raw input remains the fallback for runs
    // where the base step is skipped (`scope: full`).
    expect(reviewStep).toContain(
      "INPUT_DIRECTORY: ${{ steps.base.outputs.prefix || inputs.directory }}",
    );
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

  it("defaults blocking to none (advisory) and propagates the CLI exit code", () => {
    const actionYaml = readActionYaml();
    const inputsBlock = extractBlock(actionYaml, "inputs:", "\noutputs:");
    const blockingInput = extractBlock(actionYaml, "  blocking:", "  comment:");
    const failStep = normalizeWhitespace(
      extractStep(actionYaml, "- name: Fail if React Doctor found blocking issues"),
    );

    expect(inputsBlock).toContain("  blocking:");
    expect(normalizeWhitespace(blockingInput)).toContain('default: "none"');
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
