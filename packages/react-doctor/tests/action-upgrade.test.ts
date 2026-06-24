import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getReactDoctorWorkflowPath,
  installReactDoctorWorkflow,
  readReactDoctorWorkflow,
  upgradeWorkflowActionToV2,
  workflowUsesV1Action,
} from "../src/cli/utils/install-github-workflow.js";
import {
  getActionUpgradePromptConfigPath,
  hasHandledActionUpgrade,
  recordActionUpgradeDecision,
} from "../src/cli/utils/action-upgrade-prompt.js";

const buildWorkflow = (actionRef: string): string =>
  [
    "name: React Doctor",
    "on:",
    "  pull_request:",
    "jobs:",
    "  react-doctor:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    `      - uses: ${actionRef}`,
    "",
  ].join("\n");

describe("workflow v1 detection + upgrade", () => {
  it("detects only the floating @v1 ref", () => {
    expect(workflowUsesV1Action(buildWorkflow("millionco/react-doctor@v1"))).toBe(true);
    expect(workflowUsesV1Action(buildWorkflow("millionco/react-doctor@v2"))).toBe(false);
    // Exact tags and SHA pins are deliberate version locks — left alone.
    expect(workflowUsesV1Action(buildWorkflow("millionco/react-doctor@v1.2.3"))).toBe(false);
    expect(
      workflowUsesV1Action(
        buildWorkflow("millionco/react-doctor@b612664043a9be414166e3c6a69b355e39a8dcf4 # v1.1.1"),
      ),
    ).toBe(false);
  });

  it("rewrites the floating @v1 ref to @v2 and reports the change", () => {
    const upgraded = upgradeWorkflowActionToV2(buildWorkflow("millionco/react-doctor@v1"));
    expect(upgraded.changed).toBe(true);
    expect(upgraded.content).toContain("millionco/react-doctor@v2");
    expect(upgraded.content).not.toContain("millionco/react-doctor@v1");
  });

  it("is a no-op for workflows already on @v2 or pinned exactly", () => {
    expect(upgradeWorkflowActionToV2(buildWorkflow("millionco/react-doctor@v2")).changed).toBe(
      false,
    );
    const exact = upgradeWorkflowActionToV2(buildWorkflow("millionco/react-doctor@v1.2.3"));
    expect(exact.changed).toBe(false);
    expect(exact.content).toContain("millionco/react-doctor@v1.2.3");
  });

  it("does not offer to upgrade a workflow this installer just wrote (already @v2)", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-upgrade-install-"));
    try {
      const result = installReactDoctorWorkflow(projectRoot);
      expect(result.status).toBe("created");
      const workflow = readReactDoctorWorkflow(projectRoot);
      expect(workflow).not.toBeNull();
      expect(workflow?.content).toContain("millionco/react-doctor@v2");
      expect(workflowUsesV1Action(workflow?.content ?? "")).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("reads back an existing v1 workflow and returns null when absent", () => {
    const projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-upgrade-read-"));
    try {
      expect(readReactDoctorWorkflow(projectRoot)).toBeNull();
      const workflowPath = getReactDoctorWorkflowPath(projectRoot);
      fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
      fs.writeFileSync(workflowPath, buildWorkflow("millionco/react-doctor@v1"));
      const workflow = readReactDoctorWorkflow(projectRoot);
      expect(workflow?.workflowPath).toBe(workflowPath);
      expect(workflowUsesV1Action(workflow?.content ?? "")).toBe(true);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("action upgrade prompt state", () => {
  let configRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-action-upgrade-"));
    configRoot = root;
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("reports not-handled before the offer is answered", () => {
    expect(hasHandledActionUpgrade("/repo/a", { cwd: configRoot })).toBe(false);
  });

  it("persists a decline so the offer never repeats for that repo", () => {
    expect(recordActionUpgradeDecision("/repo/a", "declined", { cwd: configRoot })).toBe(true);
    expect(hasHandledActionUpgrade("/repo/a", { cwd: configRoot })).toBe(true);
  });

  it("treats an accept as handled too (no re-prompt while a PR is pending)", () => {
    recordActionUpgradeDecision("/repo/a", "accepted", { cwd: configRoot });
    expect(hasHandledActionUpgrade("/repo/a", { cwd: configRoot })).toBe(true);
  });

  it("scopes the decision per repo", () => {
    recordActionUpgradeDecision("/repo/a", "declined", { cwd: configRoot });
    expect(hasHandledActionUpgrade("/repo/a", { cwd: configRoot })).toBe(true);
    expect(hasHandledActionUpgrade("/repo/b", { cwd: configRoot })).toBe(false);
  });

  it("stores the decision as an action-upgrade event in the shared react-doctor config file", () => {
    recordActionUpgradeDecision("/repo/a", "declined", { cwd: configRoot });
    const configPath = getActionUpgradePromptConfigPath({ cwd: configRoot });
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const records = Object.values(stored.projects)
      .map(
        (project) =>
          (project as { events?: Record<string, { outcome?: string }> }).events?.[
            "action-upgrade-v2"
          ],
      )
      .filter(Boolean);
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("declined");
  });
});
