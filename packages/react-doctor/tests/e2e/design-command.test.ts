import { spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { setupReactProject } from "../regressions/_helpers.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-design-command-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const runDesignScan = (
  projectDirectory: string,
): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [builtCliPath, "design", ".", "--json", "--blocking", "none"],
      {
        cwd: projectDirectory,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });

describe.skipIf(!hasBuiltCli)("design command", () => {
  it("activates opt-in design rules and excludes unrelated React diagnostics", async () => {
    const projectDirectory = setupReactProject(temporaryRoot, "focused-design", {
      packageJsonExtras: {
        devDependencies: { tailwindcss: "^4.0.0" },
      },
      files: {
        "doctor.config.json": JSON.stringify({
          customRulesOnly: true,
          ignore: { tags: ["design"] },
        }),
        "src/App.tsx": `
          export const App = ({ items }: { items: string[] }) => (
            <main>
              <span className="font-mono uppercase tracking-widest">System status</span>
              {items.map((item) => <div>{item}</div>)}
            </main>
          );
        `,
      },
    });

    const result = await runDesignScan(projectDirectory);
    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    const rules = report.diagnostics.map((diagnostic: { rule: string }) => diagnostic.rule);
    expect(rules).toContain("no-uppercase-mono-label");
    expect(rules).not.toContain("jsx-key");
    expect(report.summary.score).toBeNull();
  }, 60_000);
});
