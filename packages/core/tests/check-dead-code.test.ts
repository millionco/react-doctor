import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkDeadCode } from "../src/check-dead-code.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-check-dead-code-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { react: "^19.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" } }),
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  // Canonicalize: `checkDeadCode` realpaths its root (so deslop's
  // fast-glob graph lines up with oxc-resolver), and `os.tmpdir()` is a
  // symlink into /private on macOS — tests that build worker paths from
  // this directory must use the same canonical form.
  return fs.realpathSync(projectDirectory);
};

// A Next.js `src/` project whose only edges into `Button` / `format`
// run through the `@/*` tsconfig path alias — the exact shape that
// regressed when the scan root wasn't canonicalized.
const setupAliasProject = (caseId: string): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "preserve",
        module: "esnext",
        moduleResolution: "bundler",
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
      },
    }),
    "src/app/page.tsx":
      'import { Button } from "@/components/Button";\n' +
      'import { formatName } from "@/lib/format";\n' +
      "export default function Home() { return <Button label={formatName('x')} />; }\n",
    "src/components/Button.tsx":
      "export const Button = ({ label }: { label: string }) => <button>{label}</button>;\n",
    "src/lib/format.ts":
      "export const formatName = (name: string): string => name.toUpperCase();\n",
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return projectDirectory;
};

const flaggedUnusedFiles = async (rootDirectory: string): Promise<string[]> =>
  (await checkDeadCode({ rootDirectory }))
    .filter((diagnostic) => diagnostic.rule === "unused-file")
    .map((diagnostic) => diagnostic.filePath)
    .sort();

describe("checkDeadCode", () => {
  it("returns no diagnostics when the directory has no package.json", async () => {
    const directory = path.join(tempRoot, "no-package-json");
    fs.mkdirSync(directory, { recursive: true });
    expect(await checkDeadCode({ rootDirectory: directory })).toEqual([]);
  });

  it("flags an orphan file with POSIX-separated paths under the Maintainability category", async () => {
    const directory = setupProject("unused-file", {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    });
    const diagnostics = await checkDeadCode({ rootDirectory: directory });
    const orphan = diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.plugin).toBe("deslop");
    expect(orphan?.category).toBe("Maintainability");
    expect(orphan?.filePath.includes("\\")).toBe(false);
  });

  it("honors ignore patterns from .gitignore and userConfig.ignore.files", async () => {
    const directory = setupProject("ignore-patterns", {
      "src/index.ts": "export const used = 1;\n",
      "src/gitignored.ts": "export const a = 1;\n",
      "src/configignored.ts": "export const b = 1;\n",
      ".gitignore": "src/gitignored.ts\n",
    });
    const diagnostics = await checkDeadCode({
      rootDirectory: directory,
      userConfig: { ignore: { files: ["src/configignored.ts"] } },
    });
    const flagged = diagnostics
      .filter((diagnostic) => diagnostic.rule === "unused-file")
      .map((diagnostic) => diagnostic.filePath);
    expect(flagged.some((entry) => entry.endsWith("gitignored.ts"))).toBe(false);
    expect(flagged.some((entry) => entry.endsWith("configignored.ts"))).toBe(false);
  });

  it("honors unused-file ignore patterns from knip.json", async () => {
    const directory = setupProject("knip-json-ignore", {
      "src/index.ts": "export const used = 1;\n",
      "src/knipignored.ts": "export const ignored = 1;\n",
      "knip.json": JSON.stringify({ ignore: ["src/knipignored.ts"] }),
    });

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged.some((entry) => entry.endsWith("knipignored.ts"))).toBe(false);
  });

  it("forwards knip.json entry and ignore patterns to the dead-code worker", async () => {
    const directory = setupProject("knip-json-worker-input", {
      "src/index.ts": "export const used = 1;\n",
      "knip.json": JSON.stringify({
        entry: ["src/custom-entry.ts"],
        ignore: ["src/generated.ts"],
        workspaces: {
          "packages/*": {
            entry: ["src/main.ts"],
            ignore: ["src/fixtures.ts"],
          },
        },
      }),
    });
    let capturedInput: {
      entryPatterns: ReadonlyArray<string>;
      ignorePatterns: ReadonlyArray<string>;
    } | null = null;

    await checkDeadCode({
      rootDirectory: directory,
      createWorker: (input) => {
        capturedInput = input;
        return {
          result: Promise.resolve({
            unusedFiles: [],
            unusedExports: [],
            unusedDependencies: [],
            circularDependencies: [],
          }),
        };
      },
    });

    expect(capturedInput?.entryPatterns).toContain("src/custom-entry.ts");
    expect(capturedInput?.entryPatterns).toContain("packages/*/src/main.ts");
    expect(capturedInput?.ignorePatterns).toContain("src/generated.ts");
    expect(capturedInput?.ignorePatterns).toContain("packages/*/src/fixtures.ts");
  });

  it("maps unused exports, dependencies, and cycles from worker results", async () => {
    const directory = setupProject("worker-result-shapes", {
      "src/index.ts": "export const used = 1;\n",
      "src/a.ts": "import './b';\n",
      "src/b.ts": "import './a';\n",
    });

    const diagnostics = await checkDeadCode({
      rootDirectory: directory,
      createWorker: () => ({
        result: Promise.resolve({
          unusedFiles: [],
          unusedExports: [
            {
              path: path.join(directory, "src", "index.ts"),
              name: "unused",
              line: 3,
              column: 14,
              isTypeOnly: false,
            },
            {
              path: path.join(directory, "src", "index.ts"),
              name: "UnusedType",
              line: 4,
              column: 12,
              isTypeOnly: true,
            },
          ],
          unusedDependencies: [
            {
              name: "left-pad",
              isDevDependency: false,
            },
            {
              name: "vitest",
              isDevDependency: true,
            },
          ],
          circularDependencies: [
            {
              files: [path.join(directory, "src", "a.ts"), path.join(directory, "src", "b.ts")],
            },
          ],
        }),
      }),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "unused-export",
      "unused-type",
      "unused-dependency",
      "unused-dev-dependency",
      "circular-dependency",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.rule === "unused-type")?.message).toContain(
      "Unused type export: `UnusedType`",
    );
    expect(
      diagnostics.find((diagnostic) => diagnostic.rule === "circular-dependency")?.message,
    ).toContain("src/a.ts → src/b.ts");
    // Message stays the bare name (deps collapse to `package.json:0`, so the
    // renderer lists each one); the shared rationale rides `help`, not the message (#690).
    const unusedDependency = diagnostics.find(
      (diagnostic) => diagnostic.rule === "unused-dependency",
    );
    expect(unusedDependency?.message).toBe("Unused dependency: `left-pad`");
    expect(unusedDependency?.filePath).toBe("package.json");
    expect(unusedDependency?.help).toContain("supply-chain");
    expect(
      diagnostics.find((diagnostic) => diagnostic.rule === "unused-dev-dependency")?.message,
    ).toBe("Unused devDependency: `vitest`");
  });

  it("rejects malformed worker results instead of silently dropping diagnostics", async () => {
    const directory = setupProject("malformed-worker-result", {
      "src/index.ts": "export const used = 1;\n",
    });

    await expect(
      checkDeadCode({
        rootDirectory: directory,
        createWorker: () => ({
          result: Promise.resolve({
            unusedFiles: [{ path: 1 }],
            unusedExports: [],
            unusedDependencies: [],
            circularDependencies: [],
          }),
        }),
      }),
    ).rejects.toThrow("unusedFiles[0].path");
  });

  it("times out a stuck worker", async () => {
    const directory = setupProject("stuck-worker", {
      "src/index.ts": "export const used = 1;\n",
    });
    let didTerminate = false;

    await expect(
      checkDeadCode({
        rootDirectory: directory,
        createWorker: () => ({
          result: new Promise(() => {}),
          terminate: () => {
            didTerminate = true;
          },
        }),
        workerTimeoutMs: 1,
      }),
    ).rejects.toThrow("Dead-code worker timed out");
    expect(didTerminate).toBe(true);
  });

  // deslop's import-graph resolution (oxc-resolver targets matched against
  // fast-glob's collected paths) only lines up on POSIX; on Windows it
  // mis-flags imported files regardless of the canonical-root fix — a
  // deslop limitation, not the canonicalization (orphan detection passes
  // on Windows). The symlinked-root scenario is itself POSIX/macOS.
  describe.skipIf(process.platform === "win32")("import-graph resolution (POSIX)", () => {
    it("does not flag files imported only through @/* tsconfig path aliases", async () => {
      // Canonicalize so this case isolates alias resolution from the
      // symlinked-root case below (`os.tmpdir()` is itself a symlink into
      // /private on macOS).
      const directory = fs.realpathSync(setupAliasProject("alias-imports"));
      expect(await flaggedUnusedFiles(directory)).toEqual([]);
    });

    it("does not mis-flag imports when the scan root is reached through a symlink", async () => {
      const realDirectory = setupAliasProject("symlinked-real");
      const linkedDirectory = path.join(tempRoot, "symlinked-link");
      fs.symlinkSync(realDirectory, linkedDirectory);
      expect(await flaggedUnusedFiles(linkedDirectory)).toEqual([]);
    });
  });
});
