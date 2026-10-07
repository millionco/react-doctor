import { describe, expect, it } from "vite-plus/test";
import { resolveWorkspaceDeadCodeOwner } from "../src/cli/utils/resolve-workspace-dead-code-owner.js";

describe("resolveWorkspaceDeadCodeOwner", () => {
  it("selects an enabled workspace root", () => {
    expect(
      resolveWorkspaceDeadCodeOwner({
        rootDirectory: "/repo",
        projectDirectories: ["/repo/packages/web", "/repo"],
        isRootDeadCodeEnabled: true,
      }),
    ).toBe("/repo");
  });

  it("keeps per-project analysis when the root is absent or disabled", () => {
    expect(
      resolveWorkspaceDeadCodeOwner({
        rootDirectory: "/repo",
        projectDirectories: ["/repo/packages/web"],
        isRootDeadCodeEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveWorkspaceDeadCodeOwner({
        rootDirectory: "/repo",
        projectDirectories: ["/repo"],
        isRootDeadCodeEnabled: false,
      }),
    ).toBeNull();
  });
});
