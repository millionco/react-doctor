import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { diagnose } from "../src/index.js";

// Regression fixture for the diff-scope bug where explicit include paths were
// filtered to JSX/TSX only, silently skipping changed .ts files (hooks, utils)
// that a full scan flags.
const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-changed-scope-"));

fs.writeFileSync(
  path.join(projectDirectory, "package.json"),
  JSON.stringify({
    name: "changed-scope-fixture",
    private: true,
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  }),
);
fs.writeFileSync(
  path.join(projectDirectory, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true } }),
);
fs.mkdirSync(path.join(projectDirectory, "src"));
fs.writeFileSync(
  path.join(projectDirectory, "src", "use-doubled.ts"),
  `import { useEffect, useState } from "react";

export const useDoubled = (value: number) => {
  const [doubled, setDoubled] = useState(0);
  useEffect(() => {
    setDoubled(value * 2);
  }, [value]);
  return doubled;
};
`,
);
fs.writeFileSync(
  path.join(projectDirectory, "src", "app.tsx"),
  `import { useDoubled } from "./use-doubled.js";

export const App = () => <p>{useDoubled(21)}</p>;
`,
);

afterAll(() => {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
});

describe("diagnose with changed-file include paths", () => {
  it("reports diagnostics in a changed .ts file, matching the full scan", async () => {
    const fullScan = await diagnose(projectDirectory, { deadCode: false });
    const fullScanHookRules = fullScan.diagnostics
      .filter((diagnostic) => diagnostic.filePath.endsWith("use-doubled.ts"))
      .map((diagnostic) => diagnostic.rule);
    expect(fullScanHookRules.length).toBeGreaterThan(0);

    const changedScan = await diagnose(projectDirectory, {
      deadCode: false,
      includePaths: ["src/use-doubled.ts"],
    });
    const changedScanHookRules = changedScan.diagnostics
      .filter((diagnostic) => diagnostic.filePath.endsWith("use-doubled.ts"))
      .map((diagnostic) => diagnostic.rule);

    expect(changedScanHookRules.length).toBeGreaterThan(0);
    expect(new Set(changedScanHookRules)).toEqual(new Set(fullScanHookRules));
  });
});
