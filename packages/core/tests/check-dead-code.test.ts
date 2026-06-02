import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkDeadCode } from "../src/check-dead-code.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-check-dead-code-"));

interface SetupProjectOptions {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (
  caseId: string,
  files: Record<string, string>,
  options: SetupProjectOptions = {},
): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { react: "^19.0.0", ...options.dependencies },
      ...(options.devDependencies ? { devDependencies: options.devDependencies } : {}),
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

const emptyWorkerResult = {
  unusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  circularDependencies: [],
};

const captureDeadCodeEntryPatterns = async (
  rootDirectory: string,
): Promise<ReadonlyArray<string>> => {
  let capturedEntryPatterns: ReadonlyArray<string> = [];
  await checkDeadCode({
    rootDirectory,
    createWorker: (input) => {
      capturedEntryPatterns = input.entryPatterns;
      return { result: Promise.resolve(emptyWorkerResult) };
    },
  });
  return capturedEntryPatterns;
};

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
  });

  it("passes Inertia page roots to the dead-code worker when Inertia is installed", async () => {
    const directory = setupProject(
      "inertia-worker-entry-patterns",
      {
        "src/index.ts": "export const used = 1;\n",
      },
      { dependencies: { "@inertiajs/react": "^2.0.0" } },
    );
    const capturedEntryPatterns = await captureDeadCodeEntryPatterns(directory);

    expect(capturedEntryPatterns).toContain("src/index.{ts,tsx,js,jsx}");
    expect(capturedEntryPatterns).toContain("resources/js/Pages/**/*.{ts,tsx,js,jsx,vue,svelte}");
    expect(capturedEntryPatterns).toContain("resources/js/pages/**/*.{ts,tsx,js,jsx,vue,svelte}");
    expect(capturedEntryPatterns).toContain("app/frontend/pages/**/*.{ts,tsx,js,jsx,vue,svelte}");
    expect(capturedEntryPatterns).toContain("src/Pages/**/*.{ts,tsx,js,jsx,vue,svelte}");
  });

  it("does not flag Inertia pages as orphan files", async () => {
    const directory = setupProject(
      "inertia-pages",
      {
        "resources/js/app.tsx":
          "import { createInertiaApp } from '@inertiajs/react';\n" +
          "createInertiaApp({ resolve: (name) => name, setup: () => undefined });\n",
        "resources/js/Pages/Home.tsx": "export default () => <main>Home</main>;\n",
        "resources/js/pages/Settings.tsx": "export default () => <main>Settings</main>;\n",
        "app/frontend/pages/Posts/Index.tsx": "export default () => <main>Posts</main>;\n",
        "resources/js/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { "@inertiajs/react": "^2.0.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("resources/js/Pages/Home.tsx");
    expect(flagged).not.toContain("resources/js/pages/Settings.tsx");
    expect(flagged).not.toContain("app/frontend/pages/Posts/Index.tsx");
    expect(flagged).toContain("resources/js/components/Unused.tsx");
  });

  it("does not flag Vue or Svelte Inertia pages as orphan files", async () => {
    const directory = setupProject(
      "inertia-adapters",
      {
        "resources/js/app.ts": "import { createInertiaApp } from '@inertiajs/vue3';\n",
        "resources/js/Pages/Dashboard.vue":
          "<template><main>Dashboard</main></template>\n<script setup></script>\n",
        "resources/js/pages/Profile.svelte": "<main>Profile</main>\n",
        "resources/js/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { "@inertiajs/vue3": "^2.0.0", "@inertiajs/svelte": "^2.0.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("resources/js/Pages/Dashboard.vue");
    expect(flagged).not.toContain("resources/js/pages/Profile.svelte");
    expect(flagged).toContain("resources/js/components/Unused.tsx");
  });

  it("does not flag RedwoodJS pages or layouts as orphan files", async () => {
    const directory = setupProject(
      "redwood-pages",
      {
        "web/src/Routes.tsx": "export const Routes = () => null;\n",
        "web/src/pages/HomePage/HomePage.tsx": "export default () => <main>Home</main>;\n",
        "web/src/layouts/MainLayout/MainLayout.tsx":
          "export default ({ children }: { children: React.ReactNode }) => <>{children}</>;\n",
        "web/src/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { "@redwoodjs/web": "^8.0.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("web/src/pages/HomePage/HomePage.tsx");
    expect(flagged).not.toContain("web/src/layouts/MainLayout/MainLayout.tsx");
    expect(flagged).toContain("web/src/components/Unused.tsx");
  });

  it("does not flag Waku pages as orphan files", async () => {
    const directory = setupProject(
      "waku-pages",
      {
        "src/waku.server.ts": "export default {};\n",
        "src/pages/index.tsx": "export default () => <main>Home</main>;\n",
        "src/pages/about.tsx": "export default () => <main>About</main>;\n",
        "src/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { waku: "^0.22.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("src/pages/index.tsx");
    expect(flagged).not.toContain("src/pages/about.tsx");
    expect(flagged).not.toContain("src/waku.server.ts");
    expect(flagged).toContain("src/components/Unused.tsx");
  });

  it("does not flag Vike pages or renderer hooks as orphan files", async () => {
    const directory = setupProject(
      "vike-pages",
      {
        "pages/index/+Page.tsx": "export default () => <main>Home</main>;\n",
        "pages/about/+Page.tsx": "export default () => <main>About</main>;\n",
        "renderer/+onRenderHtml.tsx": "export const onRenderHtml = () => '<main></main>';\n",
        "src/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { vike: "^0.4.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("pages/index/+Page.tsx");
    expect(flagged).not.toContain("pages/about/+Page.tsx");
    expect(flagged).not.toContain("renderer/+onRenderHtml.tsx");
    expect(flagged).toContain("src/components/Unused.tsx");
  });

  it("does not flag Rakkas routes as orphan files", async () => {
    const directory = setupProject(
      "rakkas-routes",
      {
        "src/client.tsx": "export default {};\n",
        "src/routes/index.page.tsx": "export default () => <main>Home</main>;\n",
        "src/routes/about.page.tsx": "export default () => <main>About</main>;\n",
        "src/components/Unused.tsx": "export const Unused = () => <div />;\n",
      },
      { dependencies: { rakkasjs: "^0.7.0" } },
    );

    const flagged = await flaggedUnusedFiles(directory);
    expect(flagged).not.toContain("src/routes/index.page.tsx");
    expect(flagged).not.toContain("src/routes/about.page.tsx");
    expect(flagged).not.toContain("src/client.tsx");
    expect(flagged).toContain("src/components/Unused.tsx");
  });

  it("passes module federation config roots to the dead-code worker", async () => {
    const directory = setupProject(
      "federation-worker-entry-patterns",
      {
        "module-federation.config.ts": "export default {};\n",
      },
      { devDependencies: { "@module-federation/enhanced": "^0.21.0" } },
    );

    const capturedEntryPatterns = await captureDeadCodeEntryPatterns(directory);
    expect(capturedEntryPatterns).toContain("module-federation.config.{ts,js,mjs,cjs,mts,cts}");
    expect(capturedEntryPatterns).toContain("federation.config.{ts,js,mjs,cjs,mts,cts}");
  });

  it("keeps dead-code analysis running when package.json is malformed", async () => {
    const directory = setupProject("malformed-package-json", {
      "src/index.ts": "export const used = 1;\n",
    });
    fs.writeFileSync(path.join(directory, "package.json"), "{");

    const capturedEntryPatterns = await captureDeadCodeEntryPatterns(directory);
    expect(capturedEntryPatterns).toEqual([]);
  });

  it("keeps generic page directories orphan-checkable without a matching framework", async () => {
    const directory = setupProject("ungated-pages", {
      "src/index.ts": "export const used = 1;\n",
      "src/pages/Standalone.tsx": "export default () => <main>Standalone</main>;\n",
    });

    expect(await flaggedUnusedFiles(directory)).toContain("src/pages/Standalone.tsx");
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
