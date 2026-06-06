import { describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "@react-doctor/core";
import type { ProjectInfo } from "@react-doctor/core";

const baseProject: ProjectInfo = {
  rootDirectory: "/tmp/project",
  projectName: "fixture",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  preactVersion: null,
  preactMajorVersion: null,
  hasReanimated: false,
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

  it("emits the `expo` capability when `expoVersion` is set", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "expo",
      hasReactNativeWorkspace: true,
      expoVersion: "~51.0.0",
    });
    expect(capabilities.has("expo")).toBe(true);
    expect(capabilities.has("react-native")).toBe(true);
  });

  it("emits the `expo` capability for an Expo project even when a web bundler wins framework detection", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "vite",
      hasReactNativeWorkspace: true,
      expoVersion: "~51.0.0",
    });
    expect(capabilities.has("expo"), "expo capability is keyed off expoVersion").toBe(true);
    expect(capabilities.has("vite")).toBe(true);
  });

  it("omits the `expo` capability for a non-Expo project", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "vite",
      expoVersion: null,
    });
    expect(capabilities.has("expo")).toBe(false);
  });

  it("emits `zod` and `zod:4` capabilities for Zod 4 projects", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      zodVersion: "^4.3.6",
      zodMajorVersion: 4,
    });
    expect(capabilities.has("zod")).toBe(true);
    expect(capabilities.has("zod:4")).toBe(true);
  });

  it("emits only `zod` for pre-v4 Zod projects", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      zodVersion: "^3.25.76",
      zodMajorVersion: 3,
    });
    expect(capabilities.has("zod")).toBe(true);
    expect(capabilities.has("zod:4")).toBe(false);
  });

  it("omits `zod:4` when the Zod version is unparseable", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      zodVersion: "workspace:*",
      zodMajorVersion: null,
    });
    expect(capabilities.has("zod")).toBe(true);
    expect(capabilities.has("zod:4")).toBe(false);
  });

  it("emits `nextjs:15` capability for Next.js 15+ projects", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      nextjsVersion: "^15.3.0",
      nextjsMajorVersion: 15,
    });
    expect(capabilities.has("nextjs")).toBe(true);
    expect(capabilities.has("nextjs:15")).toBe(true);
  });

  it("omits `nextjs:15` capability for Next.js 14 projects", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      nextjsVersion: "^14.2.0",
      nextjsMajorVersion: 14,
    });
    expect(capabilities.has("nextjs")).toBe(true);
    expect(capabilities.has("nextjs:15")).toBe(false);
  });

  it("omits `nextjs:15` when the Next.js version is unparseable", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      nextjsVersion: "workspace:*",
      nextjsMajorVersion: null,
    });
    expect(capabilities.has("nextjs")).toBe(true);
    expect(capabilities.has("nextjs:15")).toBe(false);
  });
});
