import { describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { prepareLintSources } from "../src/utils/prepare-lint-sources.js";

describe("prepareLintSources - missing HTML files", () => {
  it("should skip non-existent HTML files without throwing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-test-"));
    const htmlDir = path.join(tempDir, "html-prep");
    fs.mkdirSync(htmlDir, { recursive: true });

    try {
      // Create a real JS file
      const realFile = path.join(tempDir, "app.js");
      fs.writeFileSync(realFile, "console.log('test');");

      // Reference a non-existent index.html
      const nonExistentHtml = path.join(tempDir, "index.html");

      // Should not throw even though index.html doesn't exist
      const result = prepareLintSources(tempDir, htmlDir, [
        "app.js",
        "index.html", // This file doesn't exist
      ]);

      // Should only include the real JS file
      expect(result.lintFiles).toContain("app.js");
      expect(result.lintFiles).not.toContain("index.html");
      expect(result.lintFiles.some((file) => file.includes("index.html"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
