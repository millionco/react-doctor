import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { diagnose } from "../src/index.js";

const BAD_LIST =
  "const App = ({ items }) => items.map((item, index) => <li key={index}>{item}</li>);\n";

describe("diagnose — programmatic in-memory mode", () => {
  it("runs with no package.json and no files on disk", async () => {
    const result = await diagnose({
      dependencies: {
        dependencies: { react: "19.0.0" },
        devDependencies: { typescript: "^5.6.0" },
      },
      sources: [{ filePath: "App.tsx", code: BAD_LIST }],
      rules: { only: ["no-array-index-as-key"] },
    });

    expect(result.graph.reactMajor).toBe(19);
    expect(result.scannedFileCount).toBe(1);
    expect(result.ranInWorkerPool).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].rule).toBe("no-array-index-as-key");
    expect(result.capabilities).toContain("react:19");
  });

  it("gates framework rules on the supplied dependency graph", async () => {
    const webOnly = await diagnose({
      dependencies: { dependencies: { react: "19.0.0" } },
      sources: [{ filePath: "App.tsx", code: BAD_LIST }],
    });
    const reactNative = await diagnose({
      dependencies: { dependencies: { react: "19.0.0", "react-native": "0.76.0" } },
      sources: [{ filePath: "App.tsx", code: BAD_LIST }],
    });

    expect(reactNative.enabledRuleCount).toBeGreaterThan(webOnly.enabledRuleCount);
  });
});

describe("diagnose — disk mode", () => {
  const temporaryDirectories: string[] = [];

  const makeProject = (
    manifest: Record<string, unknown>,
    files: Record<string, string>,
  ): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-lite-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
    for (const [relativePath, code] of Object.entries(files)) {
      fs.writeFileSync(path.join(directory, relativePath), code);
    }
    return directory;
  };

  afterAll(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("discovers sources and dependencies from disk", async () => {
    const directory = makeProject(
      {
        name: "demo",
        dependencies: { react: "19.0.0" },
        devDependencies: { typescript: "^5.6.0" },
      },
      { "App.tsx": BAD_LIST },
    );

    const result = await diagnose({
      cwd: directory,
      rules: { only: ["no-array-index-as-key"] },
      concurrency: { disableWorkers: true },
    });

    expect(result.graph.framework).toBe("unknown");
    expect(result.graph.reactMajor).toBe(19);
    expect(result.scannedFileCount).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(path.isAbsolute(result.diagnostics[0].filePath)).toBe(true);
  });
});
