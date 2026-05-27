import { describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "@react-doctor/core";
import type { ProjectInfo } from "@react-doctor/core";

const baseProject: ProjectInfo = {
  rootDirectory: "/tmp/project",
  projectName: "fixture",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: false,
  hasPreact: false,
  sourceFileCount: 1,
};

describe("buildCapabilities", () => {
  it("emits the `preact` capability when `hasPreact` is true on a Preact-on-Vite project", () => {
    const capabilities = buildCapabilities({ ...baseProject, framework: "vite", hasPreact: true });
    expect(capabilities.has("preact")).toBe(true);
    expect(capabilities.has("vite")).toBe(true);
  });

  it("emits the `preact` capability for pure-Preact projects (no bundler manifest)", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "preact",
      hasPreact: true,
      reactVersion: null,
      reactMajorVersion: null,
    });
    expect(capabilities.has("preact")).toBe(true);
  });

  it("does not emit the `preact` capability for a non-Preact project", () => {
    const capabilities = buildCapabilities({ ...baseProject, framework: "vite", hasPreact: false });
    expect(capabilities.has("preact")).toBe(false);
  });
});
