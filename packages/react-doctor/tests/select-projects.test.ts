import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { selectProjects } from "../src/cli/utils/select-projects.js";
import { cliLogger } from "../src/cli/utils/cli-logger.js";
import { prompts } from "../src/cli/utils/prompts.js";
import { setupReactProject, writeJson } from "./regressions/_helpers.js";

vi.mock("../src/cli/utils/prompts.js", () => ({
  prompts: vi.fn(),
}));

vi.mock("../src/cli/utils/cli-logger.js", () => ({
  cliLogger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    success: vi.fn(),
    break: vi.fn(),
  },
}));

describe("selectProjects", () => {
  const tempDirectories: string[] = [];

  const createTempDirectory = (): string => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-select-projects-"));
    tempDirectories.push(tempDirectory);
    return tempDirectory;
  };

  afterEach(() => {
    vi.clearAllMocks();
    for (const tempDirectory of tempDirectories.splice(0)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("skips project selection output for a non-monorepo React project", async () => {
    const tempDirectory = createTempDirectory();
    const projectDirectory = setupReactProject(tempDirectory, "app");

    const selectedDirectories = await selectProjects(projectDirectory, undefined, false);

    expect(selectedDirectories).toEqual([projectDirectory]);
    expect(prompts).not.toHaveBeenCalled();
    expect(cliLogger.log).not.toHaveBeenCalled();
  });

  it("keeps the selected project output for a monorepo with one React workspace", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "workspace",
      workspaces: ["apps/*"],
    });
    const projectDirectory = setupReactProject(path.join(tempDirectory, "apps"), "web");

    const selectedDirectories = await selectProjects(tempDirectory, undefined, false);

    expect(selectedDirectories).toEqual([projectDirectory]);
    expect(prompts).not.toHaveBeenCalled();
    expect(cliLogger.log).toHaveBeenCalledWith(expect.stringContaining("Select projects"));
    expect(cliLogger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Select projects to scan"),
    );
  });

  it("falls through to subproject discovery for a monorepo with no workspace React packages", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "monorepo",
      workspaces: ["packages/*"],
    });
    fs.mkdirSync(path.join(tempDirectory, "packages"), { recursive: true });
    const projectDirectory = setupReactProject(path.join(tempDirectory, "nested"), "app");

    const selectedDirectories = await selectProjects(tempDirectory, undefined, false);

    expect(selectedDirectories).toEqual([projectDirectory]);
    expect(prompts).not.toHaveBeenCalled();
    expect(cliLogger.log).toHaveBeenCalledWith(expect.stringContaining("Select projects"));
    expect(cliLogger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Select projects to scan"),
    );
  });

  it("uses a concise label for interactive project selection", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "workspace",
      workspaces: ["apps/*"],
    });
    const webDirectory = setupReactProject(path.join(tempDirectory, "apps"), "web");
    setupReactProject(path.join(tempDirectory, "apps"), "docs");
    vi.mocked(prompts).mockResolvedValue({ selectedDirectories: [webDirectory] });

    const selectedDirectories = await selectProjects(tempDirectory, undefined, false);

    expect(selectedDirectories).toEqual([webDirectory]);
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "selectedDirectories",
        message: "Select projects",
      }),
    );
  });

  it("resolves --project directory paths when modules are not workspace packages", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });
    fs.mkdirSync(path.join(tempDirectory, "modules", "billing"), { recursive: true });
    fs.mkdirSync(path.join(tempDirectory, "modules", "payroll"), { recursive: true });

    const selectedDirectories = await selectProjects(
      tempDirectory,
      "modules/billing,modules/payroll",
      true,
    );

    expect(selectedDirectories).toEqual([
      path.join(tempDirectory, "modules", "billing"),
      path.join(tempDirectory, "modules", "payroll"),
    ]);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("mixes workspace package names and directory paths in --project", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "workspace",
      workspaces: ["apps/*"],
    });
    const webDirectory = setupReactProject(path.join(tempDirectory, "apps"), "web");
    setupReactProject(path.join(tempDirectory, "apps"), "docs");
    fs.mkdirSync(path.join(tempDirectory, "modules", "billing"), { recursive: true });

    const selectedDirectories = await selectProjects(tempDirectory, "web,modules/billing", true);

    expect(selectedDirectories).toEqual([
      webDirectory,
      path.join(tempDirectory, "modules", "billing"),
    ]);
  });

  it("rejects a --project entry that is neither a workspace project nor a directory", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });

    await expect(selectProjects(tempDirectory, "modules/missing", true)).rejects.toThrow(
      /is not a directory under/,
    );
  });

  it("resolves the --project flag even when discovery finds a single workspace package", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "workspace",
      workspaces: ["apps/*"],
    });
    setupReactProject(path.join(tempDirectory, "apps"), "web");
    fs.mkdirSync(path.join(tempDirectory, "modules", "billing"), { recursive: true });

    const selectedDirectories = await selectProjects(tempDirectory, "modules/billing", true);

    expect(selectedDirectories).toEqual([path.join(tempDirectory, "modules", "billing")]);
  });

  it("falls back to the root directory for --project '*' when no packages are discovered", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });

    const selectedDirectories = await selectProjects(tempDirectory, "*", true);

    expect(selectedDirectories).toEqual([tempDirectory]);
  });

  it("rejects a --project flag that names no project (e.g. just commas)", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), {
      name: "workspace",
      workspaces: ["apps/*"],
    });
    setupReactProject(path.join(tempDirectory, "apps"), "web");
    setupReactProject(path.join(tempDirectory, "apps"), "docs");

    await expect(selectProjects(tempDirectory, ",", true)).rejects.toThrow(
      /did not name any project/,
    );
  });

  it("resolves config `projects` directory paths when no --project flag is passed", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });
    fs.mkdirSync(path.join(tempDirectory, "modules", "billing"), { recursive: true });
    fs.mkdirSync(path.join(tempDirectory, "modules", "payroll"), { recursive: true });

    const selectedDirectories = await selectProjects(tempDirectory, undefined, true, [
      "modules/billing",
      "modules/payroll",
    ]);

    expect(selectedDirectories).toEqual([
      path.join(tempDirectory, "modules", "billing"),
      path.join(tempDirectory, "modules", "payroll"),
    ]);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("lets the --project flag override config `projects`", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });
    fs.mkdirSync(path.join(tempDirectory, "modules", "billing"), { recursive: true });
    fs.mkdirSync(path.join(tempDirectory, "modules", "payroll"), { recursive: true });

    const selectedDirectories = await selectProjects(tempDirectory, "modules/payroll", true, [
      "modules/billing",
    ]);

    expect(selectedDirectories).toEqual([path.join(tempDirectory, "modules", "payroll")]);
  });

  it("rejects a config `projects` entry that is neither a workspace project nor a directory", async () => {
    const tempDirectory = createTempDirectory();
    writeJson(path.join(tempDirectory, "package.json"), { name: "monolith" });

    await expect(
      selectProjects(tempDirectory, undefined, true, ["modules/missing"]),
    ).rejects.toThrow(/Config "projects" entry "modules\/missing" is not a directory under/);
  });

  it("ignores an empty or whitespace-only config `projects` list", async () => {
    const tempDirectory = createTempDirectory();
    const projectDirectory = setupReactProject(tempDirectory, "app");

    const selectedDirectories = await selectProjects(projectDirectory, undefined, true, ["  "]);

    expect(selectedDirectories).toEqual([projectDirectory]);
  });

  it("discovers nested React projects when a wrapper directory has no package.json", async () => {
    const tempDirectory = createTempDirectory();
    const frontendDirectory = setupReactProject(tempDirectory, "frontend");
    const mobileDirectory = setupReactProject(tempDirectory, "mobile");

    const selectedDirectories = await selectProjects(tempDirectory, undefined, true);

    expect(selectedDirectories.toSorted()).toEqual([frontendDirectory, mobileDirectory].toSorted());
    expect(prompts).not.toHaveBeenCalled();
    expect(cliLogger.log).toHaveBeenCalledWith(expect.stringContaining("frontend"));
    expect(cliLogger.log).toHaveBeenCalledWith(expect.stringContaining("mobile"));
  });
});
