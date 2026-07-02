import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  getReactDoctorWorkflowPath,
  installReactDoctorWorkflow,
} from "../src/cli/utils/install-github-workflow.js";

const installInTempDir = (
  defaultBranch?: string,
): { readonly content: string; readonly cleanup: () => void } => {
  const projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-workflow-install-"));
  const result = installReactDoctorWorkflow(projectRoot, defaultBranch);
  expect(result.status).toBe("created");
  return {
    content: fs.readFileSync(getReactDoctorWorkflowPath(projectRoot), "utf8"),
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
};

describe("installReactDoctorWorkflow push trigger", () => {
  it("scans the repo's default branch on push, not a hardcoded main", () => {
    const { content, cleanup } = installInTempDir("develop");
    try {
      expect(content).toContain('branches: ["develop"]');
      expect(content).toContain("Scans `develop` on every push");
      expect(content).not.toContain("[main]");
    } finally {
      cleanup();
    }
  });

  it("falls back to main when the default branch is unknown", () => {
    const { content, cleanup } = installInTempDir();
    try {
      expect(content).toContain('branches: ["main"]');
    } finally {
      cleanup();
    }
  });

  it("checks out full git history so PR runs can find the merge base", () => {
    const { content, cleanup } = installInTempDir();
    try {
      // Without fetch-depth: 0 a shallow checkout has no merge base, so the
      // compare-mode scan degrades to reporting every pre-existing issue.
      expect(content).toContain("- uses: actions/checkout@v5");
      expect(content).toContain("fetch-depth: 0");
    } finally {
      cleanup();
    }
  });
});
