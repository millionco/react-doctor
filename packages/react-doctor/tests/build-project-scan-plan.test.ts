import * as path from "node:path";
import type { DiffInfo, GitBaselineDiffPlan } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { buildProjectScanPlan } from "../src/cli/utils/build-project-scan-plan.js";

const buildDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: "feature",
  baseBranch: "main",
  changedFiles,
  isCurrentChanges: false,
});

const buildBaselineDiffPlan = (baseFiles: string[], headFiles: string[]): GitBaselineDiffPlan => ({
  baseFiles,
  headFiles,
  untrackedFiles: [],
});

describe("buildProjectScanPlan", () => {
  const rootDirectory = path.join("/repo");
  const projectDirectory = path.join(rootDirectory, "apps", "web");

  it("keeps full scans unfiltered while projecting baseline files", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: buildBaselineDiffPlan(
          ["apps/web/src/removed.tsx", "apps/admin/src/admin.tsx"],
          ["apps/web/src/current.tsx"],
        ),
        diffInfo: buildDiffInfo(["apps/web/package.json"]),
        isDiffMode: false,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: undefined,
      projectBaselineBaseFiles: ["src/removed.tsx"],
      projectBaselineHeadFiles: ["src/current.tsx"],
      shouldSkipProject: false,
      supplyChainManifestChanged: false,
    });
  });

  it("skips a diff scan with no changed or baseline source files", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: null,
        diffInfo: null,
        isDiffMode: true,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: [],
      projectBaselineBaseFiles: null,
      projectBaselineHeadFiles: null,
      shouldSkipProject: true,
      supplyChainManifestChanged: false,
    });
  });

  it("maps changed source files into the selected project", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: null,
        diffInfo: buildDiffInfo([
          "apps/admin/src/admin.tsx",
          "apps/web/src/app.tsx",
          "apps/web/README.md",
        ]),
        isDiffMode: true,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: ["src/app.tsx"],
      projectBaselineBaseFiles: null,
      projectBaselineHeadFiles: null,
      shouldSkipProject: false,
      supplyChainManifestChanged: false,
    });
  });

  it("includes a changed project manifest when supply-chain checks are enabled", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: null,
        diffInfo: buildDiffInfo(["apps/web/package.json"]),
        isDiffMode: true,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: ["package.json"],
      projectBaselineBaseFiles: null,
      projectBaselineHeadFiles: null,
      shouldSkipProject: false,
      supplyChainManifestChanged: true,
    });
  });

  it("skips a manifest-only diff when supply-chain checks are disabled", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: null,
        diffInfo: buildDiffInfo(["apps/web/package.json"]),
        isDiffMode: true,
        supplyChainEnabled: false,
      }),
    ).toEqual({
      includePaths: [],
      projectBaselineBaseFiles: null,
      projectBaselineHeadFiles: null,
      shouldSkipProject: true,
      supplyChainManifestChanged: false,
    });
  });

  it("scans baseline-only source files and preserves base and head projections", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: buildBaselineDiffPlan(
          ["apps/web/src/removed.tsx"],
          ["apps/admin/src/current.tsx"],
        ),
        diffInfo: buildDiffInfo([]),
        isDiffMode: true,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: ["src/removed.tsx"],
      projectBaselineBaseFiles: ["src/removed.tsx"],
      projectBaselineHeadFiles: [],
      shouldSkipProject: false,
      supplyChainManifestChanged: false,
    });
  });

  it("orders changed sources before the manifest include", () => {
    expect(
      buildProjectScanPlan({
        rootDirectory,
        projectDirectory,
        baselineDiffPlan: null,
        diffInfo: buildDiffInfo(["apps/web/src/app.tsx", "apps/web/package.json"]),
        isDiffMode: true,
        supplyChainEnabled: true,
      }),
    ).toEqual({
      includePaths: ["src/app.tsx", "package.json"],
      projectBaselineBaseFiles: null,
      projectBaselineHeadFiles: null,
      shouldSkipProject: false,
      supplyChainManifestChanged: true,
    });
  });
});
