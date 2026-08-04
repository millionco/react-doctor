import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getBaselineDiffPlan, getChangedLineRanges, getDiffInfo } from "@react-doctor/core";
import type { ChangedFileLineRanges, DiffInfo } from "@react-doctor/core";
import { resolveMergeBaseRef } from "../src/cli/utils/materialize-baseline-files.js";
import { resolveTuiScanScope } from "../src/cli/utils/resolve-tui-scan-scope.js";

vi.mock("@react-doctor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-doctor/core")>();
  return {
    ...actual,
    getBaselineDiffPlan: vi.fn(),
    getChangedLineRanges: vi.fn(),
    getDiffInfo: vi.fn(),
  };
});

vi.mock("../src/cli/utils/materialize-baseline-files.js", () => ({
  resolveMergeBaseRef: vi.fn(),
}));

const buildDiffInfo = (overrides: Partial<DiffInfo> = {}): DiffInfo => ({
  currentBranch: "feature",
  baseBranch: "main",
  changedFiles: ["src/app.tsx"],
  ...overrides,
});

describe("resolveTuiScanScope", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps an unscoped interactive scan full without reading git", async () => {
    await expect(
      resolveTuiScanScope({ directory: "/repo", flags: {}, userConfig: null }),
    ).resolves.toEqual({
      baselineDiffPlan: null,
      baselineIntended: false,
      baselineRef: null,
      changedLineRanges: null,
      diffInfo: null,
      scope: "full",
    });
    expect(getDiffInfo).not.toHaveBeenCalled();
  });

  it("honors a scoped scan from project config", async () => {
    const diffInfo = buildDiffInfo({ isCurrentChanges: true });
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);

    const plan = await resolveTuiScanScope({
      directory: "/repo",
      flags: {},
      userConfig: { scope: "files" },
    });

    expect(getDiffInfo).toHaveBeenCalledWith("/repo", undefined, false);
    expect(plan.scope).toBe("files");
  });

  it("builds a baseline plan for changed scope", async () => {
    const diffInfo = buildDiffInfo({ diffBaseRef: "base-commit" });
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);
    vi.mocked(getBaselineDiffPlan).mockResolvedValue({
      baseFiles: ["src/app.tsx"],
      headFiles: ["src/app.tsx"],
      untrackedFiles: [],
    });

    const plan = await resolveTuiScanScope({
      directory: "/repo",
      flags: { scope: "changed" },
      userConfig: null,
    });

    expect(getDiffInfo).toHaveBeenCalledWith("/repo", undefined, false);
    expect(resolveMergeBaseRef).not.toHaveBeenCalled();
    expect(getBaselineDiffPlan).toHaveBeenCalledWith("/repo", "base-commit");
    expect(plan.baselineIntended).toBe(true);
    expect(plan.baselineRef).toBe("base-commit");
    expect(plan.scope).toBe("changed");
  });

  it("computes line ranges against HEAD for working tree changes", async () => {
    const diffInfo = buildDiffInfo({ isCurrentChanges: true });
    const changedLineRanges: ChangedFileLineRanges[] = [{ file: "src/app.tsx", ranges: [[4, 8]] }];
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);
    vi.mocked(getChangedLineRanges).mockResolvedValue(changedLineRanges);

    const plan = await resolveTuiScanScope({
      directory: "/repo",
      flags: { scope: "lines", includeUntracked: true },
      userConfig: null,
    });

    expect(getChangedLineRanges).toHaveBeenCalledWith({
      directory: "/repo",
      baseRef: "HEAD",
      files: ["src/app.tsx"],
      includeUntracked: true,
    });
    expect(plan.changedLineRanges).toEqual(changedLineRanges);
  });
});
