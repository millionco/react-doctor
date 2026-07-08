import { describe, expect, it } from "vite-plus/test";
import { isInProjectDirectory } from "./is-in-project-directory.js";
import type { RuleContext } from "./rule-context.js";

const makeContext = (
  filename: string,
  rootDirectory?: string,
): Pick<RuleContext, "filename" | "settings"> => ({
  filename,
  settings: rootDirectory ? { "react-doctor": { rootDirectory } } : undefined,
});

describe("isInProjectDirectory", () => {
  describe("with a project root from settings", () => {
    it("ignores a matching mount point (repo checked out at /app)", () => {
      expect(isInProjectDirectory(makeContext("/app/pages/index.tsx", "/app"), "app")).toBe(false);
    });

    it("matches a top-level directory under the project root", () => {
      expect(isInProjectDirectory(makeContext("/app/app/page.tsx", "/app"), "app")).toBe(true);
    });

    it("matches a nested directory under the project root", () => {
      expect(isInProjectDirectory(makeContext("/repo/src/app/page.tsx", "/repo"), "app")).toBe(
        true,
      );
    });

    it("handles a trailing slash on the root directory", () => {
      expect(isInProjectDirectory(makeContext("/repo/app/page.tsx", "/repo/"), "app")).toBe(true);
    });

    it("handles multi-segment directory paths", () => {
      expect(
        isInProjectDirectory(makeContext("/pages/pages/api/user.ts", "/pages"), "pages/api"),
      ).toBe(true);
      expect(isInProjectDirectory(makeContext("/pages/api/user.ts", "/pages"), "pages/api")).toBe(
        false,
      );
    });
  });

  describe("without a project root", () => {
    it("treats the leading segment of an absolute path as a mount point", () => {
      expect(isInProjectDirectory(makeContext("/app/pages/index.tsx"), "app")).toBe(false);
      expect(isInProjectDirectory(makeContext("/routes/components/nav.tsx"), "routes")).toBe(false);
    });

    it("matches the directory anywhere past the first segment", () => {
      expect(isInProjectDirectory(makeContext("/app/app/page.tsx"), "app")).toBe(true);
      expect(isInProjectDirectory(makeContext("/proj/src/app/page.tsx"), "app")).toBe(true);
    });
  });

  it("returns false for an empty filename", () => {
    expect(isInProjectDirectory(makeContext(""), "app")).toBe(false);
  });
});
