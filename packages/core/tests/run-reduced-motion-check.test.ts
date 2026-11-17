import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkReducedMotion } from "../src/check-reduced-motion.js";
import { runReducedMotionCheck } from "../src/utils/run-reduced-motion-check.js";

const workerScriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/reduced-motion-worker.js",
);
const temporaryDirectories: string[] = [];
const motionSource = `import { motion } from "framer-motion";
export const App = () => <motion.div animate={{ x: 120 }}>moving</motion.div>;
`;

const createProject = (packageJson = '{"dependencies":{"framer-motion":"1.0.0"}}'): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-reduced-motion-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), packageJson);
  fs.writeFileSync(path.join(rootDirectory, "app.tsx"), motionSource);
  return rootDirectory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("runReducedMotionCheck", () => {
  it.each([
    { source: motionSource, expectedCount: 1 },
    { source: "export const App = () => <div>still</div>;", expectedCount: 0 },
    {
      source: `import { motion, MotionConfig } from "framer-motion";
export const App = () => <MotionConfig reducedMotion="always"><motion.div animate={{ x: 120 }} /></MotionConfig>;`,
      expectedCount: 0,
    },
  ])(
    "matches synchronous diagnostics and ordering: $expectedCount, $source",
    async ({ source, expectedCount }) => {
      const rootDirectory = createProject();
      fs.writeFileSync(path.join(rootDirectory, "app.tsx"), source);
      const expected = checkReducedMotion(rootDirectory);
      const workerResult = await runReducedMotionCheck({ rootDirectory, workerScriptPath });
      const fallbackResult = await runReducedMotionCheck({
        rootDirectory,
        workerScriptPath: path.join(rootDirectory, "missing-worker.js"),
      });

      expect(fs.existsSync(workerScriptPath)).toBe(true);
      expect(expected).toHaveLength(expectedCount);
      expect(JSON.stringify(workerResult)).toBe(JSON.stringify(expected));
      expect(JSON.stringify(fallbackResult)).toBe(JSON.stringify(expected));
    },
  );

  it.each(["{}", '{"dependencies":{"react":"19"}}', "{invalid json"])(
    "skips worker startup without a motion dependency: %s",
    async (packageJson) => {
      const rootDirectory = createProject(packageJson);
      const brokenWorkerScriptPath = path.join(rootDirectory, "broken-worker.js");
      fs.writeFileSync(brokenWorkerScriptPath, 'throw new Error("must not run");');
      await expect(
        runReducedMotionCheck({ rootDirectory, workerScriptPath: brokenWorkerScriptPath }),
      ).resolves.toEqual([]);
    },
  );

  it("skips projects without a package manifest", async () => {
    const rootDirectory = createProject();
    fs.rmSync(path.join(rootDirectory, "package.json"));
    await expect(runReducedMotionCheck({ rootDirectory, workerScriptPath })).resolves.toEqual([]);
  });

  it.each([
    { script: 'throw new Error("motion analysis failed");', message: "motion analysis failed" },
    { script: "process.exit(0);", message: "exited with code 0 before replying" },
    { script: "process.exit(3);", message: "exited with code 3 before replying" },
  ])("propagates worker failure: $message", async ({ script, message }) => {
    const rootDirectory = createProject();
    const brokenWorkerScriptPath = path.join(rootDirectory, "broken-worker.js");
    fs.writeFileSync(brokenWorkerScriptPath, script);
    await expect(
      runReducedMotionCheck({ rootDirectory, workerScriptPath: brokenWorkerScriptPath }),
    ).rejects.toThrow(message);
  });

  it.each([true, false])(
    "terminates on cancellation (already aborted: %s)",
    async (alreadyAborted) => {
      const rootDirectory = createProject();
      const idleWorkerScriptPath = path.join(rootDirectory, "idle-worker.mjs");
      fs.writeFileSync(
        idleWorkerScriptPath,
        'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});',
      );
      const controller = new AbortController();
      const reason = new Error("scan cancelled");
      if (alreadyAborted) controller.abort(reason);
      const pending = runReducedMotionCheck({
        rootDirectory,
        signal: controller.signal,
        workerScriptPath: idleWorkerScriptPath,
      });
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    },
  );
});
