import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { diagnose as DiagnoseFn } from "../src/index.js";

// The worker pool only engages in built (`.js`) mode — raw-TS workers cannot
// resolve the `.js`-style import specifiers. So this test drives the BUILT
// package (`dist/index.js`) and is skipped when the package has not been built
// yet. `pnpm test` runs after `build` via turbo, so CI always exercises it.
const distIndexPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const isBuilt = fs.existsSync(distIndexPath);

const BAD_LIST =
  "const App = ({ items }) => items.map((item, index) => <li key={index}>{item}</li>);\n";

describe.skipIf(!isBuilt)("worker pool over the built package", () => {
  const temporaryDirectories: string[] = [];

  afterAll(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lints a large project across worker threads", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-lite-pool-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "pool", dependencies: { react: "19.0.0" } }),
    );
    const fileCount = 40;
    for (let index = 0; index < fileCount; index++) {
      fs.writeFileSync(path.join(directory, `Component${index}.tsx`), BAD_LIST);
    }

    const { diagnose } = (await import(distIndexPath)) as { diagnose: typeof DiagnoseFn };
    const result = await diagnose({
      cwd: directory,
      rules: { only: ["no-array-index-as-key"] },
      concurrency: { poolSize: 4, batchSize: 8 },
    });

    expect(result.ranInWorkerPool).toBe(true);
    expect(result.scannedFileCount).toBe(fileCount);
    expect(result.diagnostics).toHaveLength(fileCount);
  });
});
