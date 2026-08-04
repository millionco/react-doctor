import { describe, expect, it } from "vite-plus/test";
import { filterPathsOutsideDirectories } from "../src/utils/filter-paths-outside-directories.js";

describe("filterPathsOutsideDirectories", () => {
  it("excludes normalized descendants without excluding sibling prefixes", () => {
    expect(
      filterPathsOutsideDirectories({
        rootDirectory: "/repo",
        relativePaths: [
          "apps/web/src/index.tsx",
          "apps/web-admin/src/index.tsx",
          "packages/ui/src/index.ts",
          "src/index.ts",
        ],
        excludedDirectories: ["/repo/apps/web", "/repo/packages/ui"],
      }),
    ).toEqual(["apps/web-admin/src/index.tsx", "src/index.ts"]);
  });

  it("collapses redundant nested exclusions and supports Windows separators", () => {
    expect(
      filterPathsOutsideDirectories({
        rootDirectory: "/repo",
        relativePaths: ["apps\\web\\src\\index.tsx", "apps/api/src/index.ts"],
        excludedDirectories: ["/repo/apps", "/repo/apps/web"],
      }),
    ).toEqual([]);
  });
});
