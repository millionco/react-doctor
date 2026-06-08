import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../src/inspect.js";
import { clearConfigCache } from "@react-doctor/core";
import {
  commitAll,
  initGitRepo,
  setupReactProject,
  writeFile,
  writeJson,
} from "./regressions/_helpers.js";

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "core",
  "tests",
  "fixtures",
);

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

const noReactTempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-test-"));
fs.writeFileSync(
  path.join(noReactTempDirectory, "package.json"),
  JSON.stringify({ name: "no-react", dependencies: {} }),
);

afterAll(() => {
  fs.rmSync(noReactTempDirectory, { recursive: true, force: true });
});

describe("inspect", () => {
  it("completes without throwing on a valid React project", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("throws when React dependency is missing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(inspect(noReactTempDirectory, { lint: true })).rejects.toThrow(
        "No React dependency found",
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  // Regression (#552): a Preact project has no `react` package, so the run
  // gate must let it through instead of aborting with "No React dependency".
  it("does NOT throw for a Preact project without a react dependency", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const preactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-preact-"));
    try {
      fs.writeFileSync(
        path.join(preactDirectory, "package.json"),
        JSON.stringify({ name: "preact-app", dependencies: { preact: "^10.22.0" } }),
      );
      fs.writeFileSync(
        path.join(preactDirectory, "App.tsx"),
        "export function App() { return <div>hi</div>; }\n",
      );

      const result = await inspect(preactDirectory, { lint: true });
      expect(result.project.preactVersion).toBe("^10.22.0");
      expect(result.project.reactVersion).toBe(null);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(preactDirectory, { recursive: true, force: true });
    }
  });

  it("skips lint when option is disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: false,
        deadCode: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("completes lint within the timeout budget", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const startTime = performance.now();
      await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
      });
      const elapsedMilliseconds = performance.now() - startTime;

      expect(elapsedMilliseconds).toBeLessThan(30_000);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  // Regression: when the CLI passes `configOverride`, inspect() must trust
  // the directory it was given and skip the rootDir redirect — otherwise
  // an ancestor config with `rootDir: "apps/web"` would re-route every
  // workspace-package scan back to apps/web. (Bugbot review #200.)
  it("does NOT re-apply rootDir redirect when configOverride is supplied", async () => {
    clearConfigCache();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rootdir-override-"));
    try {
      const adminProjectDirectory = setupReactProject(tempDirectory, "admin");
      setupReactProject(tempDirectory, "web");
      fs.writeFileSync(
        path.join(tempDirectory, "doctor.config.json"),
        JSON.stringify({ rootDir: "web" }),
      );

      const result = await inspect(adminProjectDirectory, {
        lint: false,
        deadCode: false,
        configOverride: null,
      });

      expect(result.project.rootDirectory).toBe(adminProjectDirectory);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  // Counterpart: when no configOverride is supplied (direct programmatic
  // inspect() call), rootDir redirection IS honored — same contract as
  // diagnose().
  it("DOES apply rootDir redirect when called without configOverride", async () => {
    clearConfigCache();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rootdir-honor-"));
    try {
      const webProjectDirectory = setupReactProject(tempDirectory, "web");
      setupReactProject(tempDirectory, "admin");
      fs.writeFileSync(
        path.join(tempDirectory, "doctor.config.json"),
        JSON.stringify({ rootDir: "web" }),
      );

      const result = await inspect(tempDirectory, {
        lint: false,
        deadCode: false,
      });

      expect(result.project.rootDirectory).toBe(webProjectDirectory);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("reuses head project metadata for baseline scans of leaf-only pnpm catalog monorepos", async () => {
    clearConfigCache();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const monorepoDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-catalog-"));
    try {
      writeFile(
        path.join(monorepoDirectory, "pnpm-workspace.yaml"),
        'packages:\n  - "apps/*"\n\ncatalog:\n  react: ^19.0.0\n',
      );
      writeJson(path.join(monorepoDirectory, "package.json"), {
        name: "monorepo-root",
        private: true,
      });
      writeJson(path.join(monorepoDirectory, "apps", "web", "package.json"), {
        name: "web",
        dependencies: { react: "catalog:" },
      });
      writeFile(
        path.join(monorepoDirectory, "apps", "web", "src", "App.tsx"),
        "export const App = () => <main>Base</main>;\n",
      );
      initGitRepo(monorepoDirectory);
      const baseRef = commitAll(monorepoDirectory, "initial catalog workspace");

      writeFile(
        path.join(monorepoDirectory, "apps", "web", "src", "App.tsx"),
        "export const App = () => <main>Head</main>;\n",
      );

      const result = await inspect(monorepoDirectory, {
        lint: true,
        deadCode: false,
        noScore: true,
        silent: true,
        includePaths: ["apps/web/src/App.tsx"],
        baseline: { ref: baseRef },
      });

      expect(result.project.reactVersion).toBe("^19.0.0");
      expect(result.skippedChecks).not.toContain("lint");
      expect(result.baselineDelta?.baseTotalCount).toBe(0);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(monorepoDirectory, { recursive: true, force: true });
    }
  });
});
