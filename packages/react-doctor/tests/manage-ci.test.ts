import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Answers, PromptObject } from "prompts";
import { buildWorkflowContent } from "../src/cli/utils/install-github-workflow.js";
import {
  runCiConfig,
  runCiInstall,
  runCiUpgrade,
  type CiCommandOptions,
} from "../src/cli/utils/ci/manage-ci.js";
import { githubActionsProvider } from "../src/cli/utils/ci/github-actions-provider.js";
import { gitlabCiProvider } from "../src/cli/utils/ci/gitlab-ci-provider.js";
import { NON_INTERACTIVE_ENVIRONMENT_VARIABLES } from "../src/cli/utils/is-non-interactive-environment.js";
import {
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";
import type { CommandRunner } from "../src/cli/utils/run-command.js";

// Everything fails, so `detectDefaultBranch` falls through to "main" and no
// real git/gh process is ever spawned.
const failingRun: CommandRunner = () => Promise.resolve({ success: false, stdout: "", stderr: "" });

interface TempProject {
  readonly root: string;
  readonly cleanup: () => void;
}

const makeTempProject = (): TempProject => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-manage-ci-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
};

const githubContent = (root: string): string =>
  githubActionsProvider.readWorkflow(root)?.content ?? "";

let project: TempProject;
let originalExitCode: number | string | null | undefined;

beforeEach(() => {
  project = makeTempProject();
  originalExitCode = process.exitCode;
});

afterEach(() => {
  project.cleanup();
  process.exitCode = originalExitCode;
});

const baseOptions = (overrides: CiCommandOptions): CiCommandOptions => ({
  cwd: project.root,
  yes: true,
  run: failingRun,
  ...overrides,
});

describe("runCiInstall", () => {
  it("scaffolds the advisory GitHub workflow", async () => {
    await runCiInstall(baseOptions({ provider: "github-actions" }));
    expect(githubContent(project.root)).toContain("# with:");
    expect(githubContent(project.root)).toContain("millionco/react-doctor@v2");
  });

  it("bakes a non-advisory gate into the workflow", async () => {
    await runCiInstall(
      baseOptions({ provider: "github-actions", blocking: "error", scope: "full" }),
    );
    expect(githubContent(project.root)).toContain("blocking: error");
    expect(githubContent(project.root)).toContain("scope: full");
  });

  it("rejects an invalid gate level", async () => {
    await runCiInstall(baseOptions({ provider: "github-actions", blocking: "loud" }));
    expect(process.exitCode).toBe(1);
    expect(githubActionsProvider.readWorkflow(project.root)).toBeNull();
  });

  it("scaffolds a GitLab merge-request job", async () => {
    await runCiInstall(baseOptions({ provider: "gitlab-ci" }));
    const content = fs.readFileSync(path.join(project.root, ".gitlab-ci.yml"), "utf8");
    expect(content).toContain("npx react-doctor@latest --blocking none");
  });
});

describe("runCiConfig", () => {
  it("applies gate flags non-interactively and round-trips", async () => {
    await runCiInstall(baseOptions({ provider: "github-actions" }));
    await runCiConfig(baseOptions({ provider: "github-actions", scope: "full", comment: false }));
    const gate = githubActionsProvider.parseGate(githubContent(project.root));
    expect(gate.scope).toBe("full");
    expect(gate.comment).toBe(false);
  });

  it("errors when there's no workflow to configure", async () => {
    await runCiConfig(baseOptions({ provider: "github-actions", scope: "full" }));
    expect(process.exitCode).toBe(1);
  });

  it("errors when the file has no React Doctor job", async () => {
    fs.writeFileSync(
      path.join(project.root, ".gitlab-ci.yml"),
      "stages: [test]\nrubocop:\n  script: true\n",
    );
    await runCiConfig(baseOptions({ provider: "gitlab-ci", blocking: "error" }));
    expect(process.exitCode).toBe(1);
  });

  it("surgically edits a customized workflow in place", async () => {
    const customized = `${buildWorkflowContent("main")}\n# teammate edit\n`;
    fs.mkdirSync(path.dirname(githubActionsProvider.workflowPath(project.root)), {
      recursive: true,
    });
    fs.writeFileSync(githubActionsProvider.workflowPath(project.root), customized);
    await runCiConfig(baseOptions({ provider: "github-actions", blocking: "error" }));
    const updated = githubContent(project.root);
    expect(githubActionsProvider.parseGate(updated).blocking).toBe("error");
    expect(updated).toContain("# teammate edit");
  });

  it("walks an interactive session and writes the chosen gate", async () => {
    await runCiInstall(baseOptions({ provider: "github-actions" }));

    const prompt = (<PromptName extends string>(
      _questions: PromptObject<PromptName> | PromptObject<PromptName>[],
    ): Promise<Answers<PromptName>> => {
      const answers = Object.create(null) as Record<string, unknown>;
      answers.blocking = "error";
      answers.scope = "changed";
      // comment left off; the two it keeps stay on.
      answers.toggles = ["reviewComments", "commitStatus"];
      return Promise.resolve(answers as Answers<PromptName>);
    }) as CiCommandOptions["prompt"];

    await withForcedInteractive(() => runCiConfig({ cwd: project.root, run: failingRun, prompt }));

    const gate = githubActionsProvider.parseGate(githubContent(project.root));
    expect(gate.blocking).toBe("error");
    expect(gate.comment).toBe(false);
    expect(gate.reviewComments).toBe(true);
  });
});

describe("runCiUpgrade", () => {
  it("bumps a floating @v1 workflow to @v2", async () => {
    fs.mkdirSync(path.dirname(githubActionsProvider.workflowPath(project.root)), {
      recursive: true,
    });
    fs.writeFileSync(
      githubActionsProvider.workflowPath(project.root),
      buildWorkflowContent("main", "v1"),
    );
    await runCiUpgrade(baseOptions({ provider: "github-actions" }));
    expect(githubContent(project.root)).toContain("millionco/react-doctor@v2");
  });

  it("reports nothing to upgrade for GitLab without throwing", async () => {
    gitlabCiProvider.scaffold(project.root, "main", {
      blocking: "none",
      scope: "changed",
      comment: true,
      reviewComments: true,
      commitStatus: true,
    });
    const before = fs.readFileSync(path.join(project.root, ".gitlab-ci.yml"), "utf8");
    await runCiUpgrade(baseOptions({ provider: "gitlab-ci" }));
    expect(fs.readFileSync(path.join(project.root, ".gitlab-ci.yml"), "utf8")).toBe(before);
  });
});

// Forces the interactive code path by clearing the CI / agent signals and
// flagging stdin as a TTY, then restoring everything — mirroring the install
// command's own interactive tests.
const withForcedInteractive = async (run: () => Promise<void>): Promise<void> => {
  const originalIsTty = process.stdin.isTTY;
  const variables = [
    ...NON_INTERACTIVE_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  ];
  const saved = new Map<string, string | undefined>();
  for (const variable of variables) {
    saved.set(variable, process.env[variable]);
    delete process.env[variable];
  }
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    await run();
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsTty });
    for (const [variable, value] of saved) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
  }
};
