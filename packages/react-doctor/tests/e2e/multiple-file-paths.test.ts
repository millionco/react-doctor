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
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-multiple-paths-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const runScanWithArgs = (
  projectDirectory: string,
  args: string[],
): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [builtCliPath, ...args, "--json", "--blocking", "none"], {
      cwd: projectDirectory,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
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

describe.skipIf(!hasBuiltCli)("multiple file paths", () => {
  it("scans specific files when multiple paths are provided", async () => {
    const projectDirectory = setupReactProject(temporaryRoot, "multi-file", {
      files: {
        "src/App.tsx": `
          export const App = ({ items }: { items: string[] }) => (
            <main>
              {items.map((item) => <div>{item}</div>)}
            </main>
          );
        `,
        "src/Other.tsx": `
          export const Other = () => {
            const x = 1;
            return <div>Hello</div>;
          };
        `,
      },
    });

    const result = await runScanWithArgs(projectDirectory, ["src/App.tsx"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    const files = report.diagnostics.map((d: { filePath: string }) => d.filePath);
    expect(files).toContain("src/App.tsx");
    expect(files).not.toContain("src/Other.tsx");
  }, 60_000);

  it("scans multiple files when provided", async () => {
    const projectDirectory = setupReactProject(temporaryRoot, "multi-file-two", {
      files: {
        "src/App.tsx": `
          export const App = ({ items }: { items: string[] }) => (
            <main>
              {items.map((item) => <div>{item}</div>)}
            </main>
          );
        `,
        "src/Other.tsx": `
          export const Other = ({ items }: { items: string[] }) => (
            <div>
              {items.map((item) => <span>{item}</span>)}
            </div>
          );
        `,
        "src/Ignored.tsx": `
          export const Ignored = ({ items }: { items: string[] }) => (
            <section>
              {items.map((item) => <p>{item}</p>)}
            </section>
          );
        `,
      },
    });

    const result = await runScanWithArgs(projectDirectory, ["src/App.tsx", "src/Other.tsx"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    const files = new Set(report.diagnostics.map((d: { filePath: string }) => d.filePath));
    expect(files.has("src/App.tsx")).toBe(true);
    expect(files.has("src/Other.tsx")).toBe(true);
    expect(files.has("src/Ignored.tsx")).toBe(false);
  }, 60_000);

  it("scans current directory when no paths are provided", async () => {
    const projectDirectory = setupReactProject(temporaryRoot, "no-args", {
      files: {
        "src/App.tsx": `
          export const App = ({ items }: { items: string[] }) => (
            <main>
              {items.map((item) => <div>{item}</div>)}
            </main>
          );
        `,
      },
    });

    const result = await runScanWithArgs(projectDirectory, []);
    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    const files = report.diagnostics.map((d: { filePath: string }) => d.filePath);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("src/App.tsx");
  }, 60_000);
});
