import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProject, formatFrameworkName } from "../src/utils/discover-project.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const VALID_FRAMEWORKS = ["nextjs", "vite", "cra", "remix", "gatsby", "roblox-ts", "unknown"];

describe("discoverProject", () => {
  it("detects React version from package.json", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("returns a valid framework", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(VALID_FRAMEWORKS).toContain(projectInfo.framework);
  });

  it("detects TypeScript when tsconfig.json exists", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.hasTypeScript).toBe(true);
  });

  it("throws when package.json is missing", () => {
    expect(() => discoverProject("/nonexistent/path")).toThrow("No package.json found");
  });

  it("counts source files in non-git projects", () => {
    const temporaryProjectDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-non-git-"),
    );

    try {
      fs.mkdirSync(path.join(temporaryProjectDirectory, "src"));
      fs.writeFileSync(
        path.join(temporaryProjectDirectory, "package.json"),
        JSON.stringify(
          {
            name: "non-git-fixture",
            version: "1.0.0",
            dependencies: {
              react: "^19.0.0",
            },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(
        path.join(temporaryProjectDirectory, "src", "app.tsx"),
        "export const App = () => <div />;\n",
      );

      const projectInfo = discoverProject(temporaryProjectDirectory);
      expect(projectInfo.sourceFileCount).toBe(1);
    } finally {
      fs.rmSync(temporaryProjectDirectory, { recursive: true, force: true });
    }
  });

  it("detects roblox-ts when @rbxts/react and roblox types are present", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "roblox-react-clean"));
    expect(projectInfo.framework).toBe("roblox-ts");
  });

  it("does not detect roblox-ts when tsconfig marker types are missing", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "roblox-react-missing-types"),
    );
    expect(projectInfo.framework).toBe("unknown");
  });

  it("prioritizes roblox-ts over nextjs when both are present", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "roblox-next-conflict"));
    expect(projectInfo.framework).toBe("roblox-ts");
  });

  it("supports framework overrides", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      frameworkOverride: "roblox-ts",
    });
    expect(projectInfo.framework).toBe("roblox-ts");
  });
});

describe("formatFrameworkName", () => {
  it("formats known frameworks", () => {
    expect(formatFrameworkName("nextjs")).toBe("Next.js");
    expect(formatFrameworkName("vite")).toBe("Vite");
    expect(formatFrameworkName("cra")).toBe("Create React App");
    expect(formatFrameworkName("remix")).toBe("Remix");
    expect(formatFrameworkName("gatsby")).toBe("Gatsby");
    expect(formatFrameworkName("roblox-ts")).toBe("Roblox (roblox-ts)");
  });

  it("formats unknown framework as React", () => {
    expect(formatFrameworkName("unknown")).toBe("React");
  });
});
