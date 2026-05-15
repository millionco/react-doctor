import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../src/core/inspect.js";
import { clearConfigCache } from "../src/core/load-config.js";
import { setupReactProject } from "./regressions/_helpers.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");

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

  it("skips lint when option is disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: false,
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
        path.join(tempDirectory, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "web" }),
      );

      const result = await inspect(adminProjectDirectory, {
        lint: false,
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
        path.join(tempDirectory, "react-doctor.config.json"),
        JSON.stringify({ rootDir: "web" }),
      );

      const result = await inspect(tempDirectory, {
        lint: false,
      });

      expect(result.project.rootDirectory).toBe(webProjectDirectory);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
