import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runEditorScan } from "@react-doctor/core";

describe("runEditorScan", () => {
  it("resolves config rootDir inside the Effect-owned scan lifecycle", async () => {
    const wrapperDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-editor-scan-"));
    const projectDirectory = path.join(wrapperDirectory, "app");
    fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(wrapperDirectory, "doctor.config.json"),
      JSON.stringify({ rootDir: "app", lint: false }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "editor-project", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "src", "index.tsx"),
      "export const App = () => null;",
    );

    try {
      const result = await runEditorScan({ directory: wrapperDirectory });

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.resolvedDirectory).toBe(projectDirectory);
      expect(result.project?.projectName).toBe("editor-project");
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      fs.rmSync(wrapperDirectory, { recursive: true, force: true });
    }
  });
});
