import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildWorkflowContent } from "../src/cli/utils/install-github-workflow.js";
import type { CommandRunner, RunCommandResult } from "../src/cli/utils/run-command.js";
import { ADVISORY_GATE, summarizeGate, type CiGate } from "../src/cli/utils/ci/ci-provider.js";
import { githubActionsProvider } from "../src/cli/utils/ci/github-actions-provider.js";
import { gitlabCiProvider } from "../src/cli/utils/ci/gitlab-ci-provider.js";
import { detectCiProvider } from "../src/cli/utils/ci/detect-ci-provider.js";
import { applyGateFlags, hasAnyGateFlag } from "../src/cli/utils/ci/resolve-ci-gate.js";

const ERROR_GATE: CiGate = { ...ADVISORY_GATE, blocking: "error", scope: "full" };

const succeed = (stdout = ""): RunCommandResult => ({ success: true, stdout, stderr: "" });
const fail = (): RunCommandResult => ({ success: false, stdout: "", stderr: "" });
const runner =
  (result: RunCommandResult): CommandRunner =>
  () =>
    Promise.resolve(result);

interface TempProject {
  readonly root: string;
  readonly cleanup: () => void;
}

const makeTempProject = (): TempProject => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-ci-provider-"));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
};

describe("githubActionsProvider gate parsing", () => {
  it("reports the advisory defaults for the canonical commented template", () => {
    expect(githubActionsProvider.parseGate(buildWorkflowContent("main"))).toEqual(ADVISORY_GATE);
  });

  it("reads an active with: block back into a gate", () => {
    const edited = githubActionsProvider.applyGate(buildWorkflowContent("main"), ERROR_GATE);
    expect(edited).not.toBeNull();
    expect(edited?.content).toContain("blocking: error");
    expect(edited?.content).toContain("scope: full");
    expect(edited?.content).not.toContain("# with:");
    expect(githubActionsProvider.parseGate(edited?.content ?? "")).toEqual(ERROR_GATE);
  });

  it("reads React Doctor's own gate, not a preceding step's with: block", () => {
    const workflow = [
      "jobs:",
      "  ci:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "      - uses: millionco/react-doctor@v2",
      "        with:",
      "          blocking: error",
      "          scope: full",
      "",
    ].join("\n");
    expect(githubActionsProvider.parseGate(workflow)).toEqual(ERROR_GATE);
  });

  it("ignores a comment mentioning the action above the real step", () => {
    const workflow = [
      "jobs:",
      "  ci:",
      "    steps:",
      "      # we run millionco/react-doctor@v2 on every PR",
      "      - uses: actions/checkout@v5",
      "      - uses: millionco/react-doctor@v2",
      "        with:",
      "          blocking: error",
      "          scope: full",
      "",
    ].join("\n");
    expect(githubActionsProvider.parseGate(workflow)).toEqual(ERROR_GATE);
  });

  it("reads quoted scalar values like the bare forms", () => {
    const workflow = [
      "jobs:",
      "  ci:",
      "    steps:",
      "      - uses: millionco/react-doctor@v2",
      "        with:",
      '          blocking: "error"',
      "          scope: 'full'",
      "",
    ].join("\n");
    expect(githubActionsProvider.parseGate(workflow)).toEqual(ERROR_GATE);
  });

  it("round-trips an active gate back to the advisory template", () => {
    const active = githubActionsProvider.applyGate(buildWorkflowContent("main"), ERROR_GATE);
    const reverted = githubActionsProvider.applyGate(active?.content ?? "", ADVISORY_GATE);
    expect(reverted).not.toBeNull();
    expect(reverted?.content).toContain("# with:");
    expect(githubActionsProvider.parseGate(reverted?.content ?? "")).toEqual(ADVISORY_GATE);
  });

  it("preserves the push branch and the pinned action ref when editing", () => {
    const edited = githubActionsProvider.applyGate(
      buildWorkflowContent("develop", "v1"),
      ERROR_GATE,
    );
    expect(edited?.content).toContain('branches: ["develop"]');
    expect(edited?.content).toContain("millionco/react-doctor@v1");
    expect(edited?.content).toContain("blocking: error");
  });

  it("surgically edits a customized workflow, preserving everything else", () => {
    const customized = [
      "name: React Doctor",
      "on:",
      "  pull_request:",
      "jobs:",
      "  react-doctor:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v5",
      "      - uses: millionco/react-doctor@v2 # pinned",
      "        with:",
      "          directory: apps/web",
      "          node-version: 24",
      "          blocking: none",
      "",
    ].join("\n");
    const edited = githubActionsProvider.applyGate(customized, ERROR_GATE);
    expect(edited).not.toBeNull();
    expect(githubActionsProvider.parseGate(edited?.content ?? "")).toEqual(ERROR_GATE);
    // The other step, the action ref + its comment, and the unmanaged inputs survive.
    expect(edited?.content).toContain("actions/checkout@v5");
    expect(edited?.content).toContain("millionco/react-doctor@v2 # pinned");
    expect(edited?.content).toContain("directory: apps/web");
    expect(edited?.content).toContain("node-version: 24");
  });

  it("creates a with: block when the React Doctor step has none", () => {
    const customized = [
      "jobs:",
      "  react-doctor:",
      "    steps:",
      "      - run: echo hi",
      "      - uses: millionco/react-doctor@v2",
      "",
    ].join("\n");
    const edited = githubActionsProvider.applyGate(customized, ERROR_GATE);
    expect(githubActionsProvider.parseGate(edited?.content ?? "")).toEqual(ERROR_GATE);
    expect(edited?.content).toContain("- run: echo hi");
  });

  it("removes a managed key when it returns to the action default", () => {
    const active = githubActionsProvider.applyGate(
      [
        "jobs:",
        "  react-doctor:",
        "    steps:",
        "      - uses: millionco/react-doctor@v2",
        "        with:",
        "          blocking: error",
        "          directory: apps/web",
        "",
      ].join("\n"),
      ADVISORY_GATE,
    );
    expect(active?.content).not.toContain("blocking:");
    expect(active?.content).toContain("directory: apps/web");
    expect(githubActionsProvider.parseGate(active?.content ?? "")).toEqual(ADVISORY_GATE);
  });

  it("edits a flow-style with: mapping", () => {
    const flow = [
      "jobs:",
      "  react-doctor:",
      "    steps:",
      "      - uses: millionco/react-doctor@v2",
      "        with: { blocking: none, directory: apps/web }",
      "",
    ].join("\n");
    const edited = githubActionsProvider.applyGate(flow, ERROR_GATE);
    expect(githubActionsProvider.parseGate(edited?.content ?? "").blocking).toBe("error");
    expect(edited?.content).toContain("apps/web");
  });

  it("refuses (null) when there is no React Doctor step", () => {
    const other = ["jobs:", "  ci:", "    steps:", "      - uses: actions/checkout@v5", ""].join(
      "\n",
    );
    expect(githubActionsProvider.applyGate(other, ERROR_GATE)).toBeNull();
  });

  it("reports whether a workflow wires up React Doctor", () => {
    expect(githubActionsProvider.containsReactDoctor(buildWorkflowContent("main"))).toBe(true);
    const noStep = ["jobs:", "  ci:", "    steps:", "      - uses: actions/checkout@v5", ""].join(
      "\n",
    );
    expect(githubActionsProvider.containsReactDoctor(noStep)).toBe(false);
  });

  it("upgrades a floating @v1 ref to @v2", () => {
    const v1 = buildWorkflowContent("main", "v1");
    const upgraded = githubActionsProvider.upgradeMajor?.(v1);
    expect(upgraded?.changed).toBe(true);
    expect(upgraded?.content).toContain("millionco/react-doctor@v2");
    expect(githubActionsProvider.upgradeMajor?.(buildWorkflowContent("main", "v2")).changed).toBe(
      false,
    );
  });
});

describe("githubActionsProvider scaffold", () => {
  let project: TempProject;
  beforeEach(() => {
    project = makeTempProject();
  });
  afterEach(() => project.cleanup());

  it("writes the advisory template for a fresh project", () => {
    const result = githubActionsProvider.scaffold(project.root, "main", ADVISORY_GATE);
    expect(result.status).toBe("created");
    expect(fs.readFileSync(result.path, "utf8")).toContain("# with:");
  });

  it("bakes the gate into the with: block when it isn't advisory", () => {
    const result = githubActionsProvider.scaffold(project.root, "main", ERROR_GATE);
    expect(fs.readFileSync(result.path, "utf8")).toContain("blocking: error");
  });

  it("never overwrites an existing workflow", () => {
    githubActionsProvider.scaffold(project.root, "main", ADVISORY_GATE);
    expect(githubActionsProvider.scaffold(project.root, "main", ERROR_GATE).status).toBe("exists");
  });

  it("finds and manages the action in a non-canonical workflow file", () => {
    const workflowsDir = path.join(project.root, ".github", "workflows");
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowsDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: millionco/react-doctor@v2",
        "        with:",
        "          blocking: error",
        "",
      ].join("\n"),
    );
    const found = githubActionsProvider.readWorkflow(project.root);
    expect(found?.path.endsWith("ci.yml")).toBe(true);
    expect(githubActionsProvider.parseGate(found?.content ?? "").blocking).toBe("error");
    // `ci install` must not add a duplicate react-doctor.yml.
    expect(githubActionsProvider.scaffold(project.root, "main", ADVISORY_GATE).status).toBe(
      "exists",
    );
  });
});

describe("gitlabCiProvider", () => {
  let project: TempProject;
  beforeEach(() => {
    project = makeTempProject();
  });
  afterEach(() => project.cleanup());

  it("scaffolds an advisory merge-request job", () => {
    const result = gitlabCiProvider.scaffold(project.root, "main", ADVISORY_GATE);
    const content = fs.readFileSync(result.path, "utf8");
    expect(result.path.endsWith(".gitlab-ci.yml")).toBe(true);
    expect(content).toContain("--blocking none --scope changed");
    expect(content).toContain('--base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"');
    expect(content).toContain('if: $CI_PIPELINE_SOURCE == "merge_request_event"');
  });

  it("drops the base flag for a whole-project scope", () => {
    const content = fs.readFileSync(
      gitlabCiProvider.scaffold(project.root, "main", ERROR_GATE).path,
      "utf8",
    );
    expect(content).toContain("--blocking error --scope full");
    expect(content).not.toContain("--base");
  });

  it("edits the scan line in place, even folded into a larger pipeline", () => {
    const advisory = gitlabCiProvider.scaffold(project.root, "main", ADVISORY_GATE);
    const content = fs.readFileSync(advisory.path, "utf8");
    expect(gitlabCiProvider.parseGate(content)).toEqual(ADVISORY_GATE);
    expect(gitlabCiProvider.applyGate(content, ERROR_GATE)?.content).toContain("--blocking error");

    const merged = `${content}\nrubocop:\n  script: true\n`;
    const edited = gitlabCiProvider.applyGate(merged, ERROR_GATE);
    expect(edited?.content).toContain("--blocking error");
    expect(edited?.content).toContain("rubocop:");
  });

  it("adds --base on a diff scope and removes it on full", () => {
    const full = fs.readFileSync(
      gitlabCiProvider.scaffold(project.root, "main", ERROR_GATE).path,
      "utf8",
    );
    expect(full).not.toContain("--base");
    const toDiff = gitlabCiProvider.applyGate(full, { ...ERROR_GATE, scope: "changed" });
    expect(toDiff?.content).toContain('--base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"');
    expect(gitlabCiProvider.applyGate(toDiff?.content ?? "", ERROR_GATE)?.content).not.toContain(
      "--base",
    );
  });

  it("refuses (null) when there is no scan line", () => {
    expect(gitlabCiProvider.applyGate("stages: [test]\n", ERROR_GATE)).toBeNull();
  });

  it("adds a missing flag instead of skipping the change", () => {
    const onlyBlocking = [
      "react-doctor:",
      "  script:",
      "    - npx react-doctor@latest --blocking none",
      "",
    ].join("\n");
    const edited = gitlabCiProvider.applyGate(onlyBlocking, { ...ADVISORY_GATE, scope: "full" });
    expect(edited?.content).toContain("--scope full");
  });

  it("ignores an install step and edits the real scan line", () => {
    const withInstall = [
      "react-doctor:",
      "  script:",
      "    - npm install react-doctor@latest",
      "    - npx react-doctor@latest --blocking none --scope changed",
      "",
    ].join("\n");
    expect(gitlabCiProvider.parseGate(withInstall)).toEqual(ADVISORY_GATE);
    const edited = gitlabCiProvider.applyGate(withInstall, { ...ADVISORY_GATE, blocking: "error" });
    expect(edited?.content).toContain("- npm install react-doctor@latest");
    expect(edited?.content).toContain("--blocking error");
    expect(edited?.content).not.toContain("install react-doctor@latest --blocking");
  });

  it("handles a multiline block-scalar script", () => {
    const block = [
      "react-doctor:",
      "  script:",
      "    - |",
      "      npx react-doctor@latest --blocking error --scope changed",
      "",
    ].join("\n");
    expect(gitlabCiProvider.containsReactDoctor(block)).toBe(true);
    expect(gitlabCiProvider.parseGate(block).blocking).toBe("error");
    const edited = gitlabCiProvider.applyGate(block, { ...ADVISORY_GATE, blocking: "warning" });
    expect(edited?.content).toContain("--blocking warning");
    expect(edited?.content).toContain("- |");
  });

  it("reports whether a file wires up a React Doctor job", () => {
    const config = fs.readFileSync(
      gitlabCiProvider.scaffold(project.root, "main", ADVISORY_GATE).path,
      "utf8",
    );
    expect(gitlabCiProvider.containsReactDoctor(config)).toBe(true);
    expect(gitlabCiProvider.containsReactDoctor("stages: [test]\nrubocop:\n  script: true\n")).toBe(
      false,
    );
  });

  it("never overwrites an existing .gitlab-ci.yml", () => {
    fs.writeFileSync(path.join(project.root, ".gitlab-ci.yml"), "stages: [test]\n");
    expect(gitlabCiProvider.scaffold(project.root, "main", ADVISORY_GATE).status).toBe("exists");
  });

  it("reads the gate off React Doctor's own job, not another job's flags", () => {
    const merged = [
      "other-tool:",
      "  script:",
      "    - some-tool --blocking warning --scope full",
      "react-doctor:",
      "  script:",
      '    - npx react-doctor@latest --blocking error --scope changed --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"',
      "",
    ].join("\n");
    const gate = gitlabCiProvider.parseGate(merged);
    expect(gate.blocking).toBe("error");
    expect(gate.scope).toBe("changed");
  });

  it("ignores a comment line that mentions react-doctor and gate flags", () => {
    const config = [
      "# legacy: react-doctor --blocking warning --scope full",
      "react-doctor:",
      "  script:",
      "    - npx react-doctor@latest --blocking error --scope changed",
      "",
    ].join("\n");
    const gate = gitlabCiProvider.parseGate(config);
    expect(gate.blocking).toBe("error");
    expect(gate.scope).toBe("changed");
  });
});

describe("detectCiProvider", () => {
  let project: TempProject;
  beforeEach(() => {
    project = makeTempProject();
  });
  afterEach(() => project.cleanup());

  it("prefers an existing GitHub workflow on disk", async () => {
    fs.mkdirSync(path.join(project.root, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(project.root, ".github", "workflows", "react-doctor.yml"),
      "name: React Doctor\n",
    );
    expect(await detectCiProvider(project.root, runner(succeed("git@gitlab.com:o/r.git")))).toBe(
      "github-actions",
    );
  });

  it("detects an existing .gitlab-ci.yml", async () => {
    fs.writeFileSync(path.join(project.root, ".gitlab-ci.yml"), "stages: [test]\n");
    expect(await detectCiProvider(project.root, runner(fail()))).toBe("gitlab-ci");
  });

  it("falls back to the git remote host", async () => {
    expect(
      await detectCiProvider(project.root, runner(succeed("https://github.com/o/r.git"))),
    ).toBe("github-actions");
    expect(
      await detectCiProvider(project.root, runner(succeed("git@gitlab.example.com:o/r.git"))),
    ).toBe("gitlab-ci");
  });

  it("prefers the GitHub remote over a stray .gitlab-ci.yml", async () => {
    fs.writeFileSync(path.join(project.root, ".gitlab-ci.yml"), "stages: [test]\n");
    expect(
      await detectCiProvider(project.root, runner(succeed("https://github.com/o/r.git"))),
    ).toBe("github-actions");
  });

  it("returns null when nothing is conclusive", async () => {
    expect(await detectCiProvider(project.root, runner(fail()))).toBeNull();
  });
});

describe("applyGateFlags", () => {
  it("layers valid flags onto the base gate", () => {
    const result = applyGateFlags(ADVISORY_GATE, { blocking: "error", comment: false });
    expect(result.error).toBeNull();
    expect(result.gate.blocking).toBe("error");
    expect(result.gate.comment).toBe(false);
  });

  it("rejects an invalid gate level without changing anything", () => {
    const result = applyGateFlags(ADVISORY_GATE, { blocking: "loud" });
    expect(result.error).toContain("Invalid --blocking");
    expect(result.gate).toEqual(ADVISORY_GATE);
  });

  it("rejects an invalid scope", () => {
    expect(applyGateFlags(ADVISORY_GATE, { scope: "everything" }).error).toContain(
      "Invalid --scope",
    );
  });

  it("reports no flags when none are passed", () => {
    expect(hasAnyGateFlag({})).toBe(false);
    expect(hasAnyGateFlag({ scope: "full" })).toBe(true);
  });
});

describe("summarizeGate", () => {
  it("renders one plain line per supported field", () => {
    const lines = summarizeGate(ERROR_GATE, githubActionsProvider.supportedGateKeys);
    expect(lines).toContain("Fail the check on new error-level findings");
    expect(lines).toContain("Scan the whole project on every run");
  });

  it("omits fields a provider can't honor", () => {
    const lines = summarizeGate(ERROR_GATE, gitlabCiProvider.supportedGateKeys);
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("comment"))).toBe(false);
  });
});
