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
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
};

describe("buildCapabilities", () => {
  it("emits the `preact` capability when `preactVersion` is set on a Preact-on-Vite project", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "vite",
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
    });
    expect(capabilities.has("preact")).toBe(true);
    expect(capabilities.has("vite")).toBe(true);
  });

  it("emits a `preact:<major>` ladder from `preactMajorVersion`, mirroring `react:<major>`", () => {
    const preact11 = buildCapabilities({
      ...baseProject,
      framework: "preact",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "^11.0.0",
      preactMajorVersion: 11,
    });
    expect(preact11.has("preact:10")).toBe(true);
    expect(preact11.has("preact:11")).toBe(true);

    const preact10 = buildCapabilities({
      ...baseProject,
      framework: "preact",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
    });
    expect(preact10.has("preact:10")).toBe(true);
    expect(preact10.has("preact:11")).toBe(false);
  });

  it("omits the `preact:<major>` ladder when the version is unparseable", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "preact",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "workspace:*",
      preactMajorVersion: null,
    });
    expect(capabilities.has("preact")).toBe(true);
    expect(capabilities.has("preact:10")).toBe(false);
  });

  it("caps the `preact:<major>` ladder for an absurd (untrusted) version spec", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "preact",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "^99999.0.0",
      preactMajorVersion: 99999,
    });
    expect(capabilities.has("preact:10")).toBe(true);
    expect(capabilities.has("preact:20")).toBe(true);
    expect(capabilities.has("preact:21")).toBe(false);
    expect(capabilities.has("preact:99999")).toBe(false);
  });

  it("emits the `preact` capability for pure-Preact projects (no bundler manifest)", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "preact",
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
      reactVersion: null,
      reactMajorVersion: null,
    });
    expect(capabilities.has("preact")).toBe(true);
  });

  it("does not emit the `preact` or `pure-preact` capabilities for a non-Preact project", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "vite",
      preactVersion: null,
      preactMajorVersion: null,
    });
    expect(capabilities.has("preact")).toBe(false);
    expect(capabilities.has("pure-preact")).toBe(false);
  });

  it("emits `pure-preact` only when no `react` is present alongside Preact", () => {
    const purePreact = buildCapabilities({
      ...baseProject,
      framework: "preact",
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
      reactVersion: null,
      reactMajorVersion: null,
    });
    expect(purePreact.has("pure-preact")).toBe(true);

    const compatStyle = buildCapabilities({
      ...baseProject,
      framework: "vite",
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
      reactVersion: "18.3.1",
      reactMajorVersion: 18,
    });
    expect(compatStyle.has("preact")).toBe(true);
    expect(compatStyle.has("pure-preact")).toBe(false);
  });
});
