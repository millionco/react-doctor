import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/types/index.js";
import {
  buildCapabilities,
  getCapabilities,
  shouldEnableRule,
} from "../src/project-info/capabilities.js";

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
  hasSsrDependency: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  preactVersion: null,
  preactMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  isStaticExport: false,
  sourceFileCount: 1,
};

describe("buildCapabilities", () => {
  it("emits exactly the expected token set for a fully-featured Next.js project", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      reactVersion: "19.2.0",
      reactMajorVersion: 19,
      tailwindVersion: "^3.4.1",
      zodVersion: "^4.0.0",
      zodMajorVersion: 4,
      nextjsVersion: "^15.3.0",
      nextjsMajorVersion: 15,
      hasReactCompiler: true,
      hasTanStackQuery: true,
      hasTypeScript: true,
    });
    expect([...capabilities].sort()).toEqual([
      "nextjs",
      "nextjs:15",
      "react",
      "react-compiler",
      "react:17",
      "react:18",
      "react:19",
      "react:19.2",
      "server-actions",
      "ssr",
      "tailwind",
      "tailwind:3.4",
      "tanstack-query",
      "typescript",
      "zod",
      "zod:4",
    ]);
  });

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

  it("emits `server-actions` for server-capable frameworks only", () => {
    for (const framework of ["nextjs", "tanstack-start", "remix"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("server-actions")).toBe(true);
    }
    for (const framework of ["vite", "cra", "gatsby", "expo", "react-native", "unknown"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("server-actions")).toBe(false);
    }
  });

  it("emits `nextjs:static-export` and drops `server-actions` for a statically-exported Next.js app", () => {
    const staticExport = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      isStaticExport: true,
    });
    expect(staticExport.has("nextjs:static-export")).toBe(true);
    expect(staticExport.has("server-actions")).toBe(false);

    const serverNext = buildCapabilities({ ...baseProject, framework: "nextjs" });
    expect(serverNext.has("nextjs:static-export")).toBe(false);
    expect(serverNext.has("server-actions")).toBe(true);
  });

  it("emits `client-only` for SPA / mobile frameworks only", () => {
    for (const framework of ["vite", "cra", "gatsby", "react-native", "expo"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("client-only")).toBe(true);
    }
    for (const framework of ["nextjs", "remix", "tanstack-start", "preact", "unknown"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("client-only")).toBe(false);
    }
  });

  it("emits `ssr` for frameworks that render hydratable HTML", () => {
    for (const framework of ["nextjs", "remix", "gatsby", "tanstack-start"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("ssr")).toBe(true);
    }
    for (const framework of ["vite", "cra", "expo", "react-native", "preact", "unknown"] as const) {
      expect(buildCapabilities({ ...baseProject, framework }).has("ssr")).toBe(false);
    }
  });

  it("emits `ssr` for Vite only with concrete SSR dependency evidence", () => {
    expect(buildCapabilities({ ...baseProject, framework: "vite" }).has("ssr")).toBe(false);
    expect(
      buildCapabilities({
        ...baseProject,
        framework: "vite",
        hasSsrDependency: true,
      }).has("ssr"),
    ).toBe(true);
  });

  it("does not treat a statically-exported Next.js app as `client-only`", () => {
    const staticExport = buildCapabilities({
      ...baseProject,
      framework: "nextjs",
      isStaticExport: true,
    });
    expect(staticExport.has("client-only")).toBe(false);
  });

  it("returns one memoized set per ProjectInfo identity via getCapabilities", () => {
    const first = getCapabilities(baseProject);
    expect(getCapabilities(baseProject)).toBe(first);
    expect(getCapabilities({ ...baseProject })).not.toBe(first);
  });

  it("emits `pre-es2023` when the project target predates ES2023", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      isPreES2023Target: true,
    });

    expect(capabilities.has("pre-es2023")).toBe(true);
  });

  it("disables rules when a disabledWhen capability is present", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      isPreES2023Target: true,
    });

    expect(shouldEnableRule(undefined, undefined, capabilities, new Set(), ["pre-es2023"])).toBe(
      false,
    );
  });

  it("emits the `react` capability for a React project", () => {
    expect(buildCapabilities(baseProject).has("react")).toBe(true);
  });

  it("emits the `react` capability for a Preact project (React-compatible runtime)", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "preact",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: "^10.22.0",
      preactMajorVersion: 10,
    });
    expect(capabilities.has("react")).toBe(true);
  });

  it("omits the `react` capability for a plain TypeScript project with no React or Preact", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "unknown",
      reactVersion: null,
      reactMajorVersion: null,
      preactVersion: null,
      preactMajorVersion: null,
    });
    expect(capabilities.has("react")).toBe(false);
    // Framework-agnostic capabilities still surface so TypeScript rules run.
    expect(capabilities.has("typescript")).toBe(true);
  });
});

describe("shouldEnableRule react gating", () => {
  const reactCapabilities = new Set(["react", "typescript"]);
  const noReactCapabilities = new Set(["typescript"]);
  const noIgnoredTags = new Set<string>();

  it("disables a `react-jsx-only` rule when the project has no React", () => {
    expect(
      shouldEnableRule(undefined, ["react-jsx-only"], noReactCapabilities, noIgnoredTags),
    ).toBe(false);
  });

  it("enables a `react-jsx-only` rule when the project has React", () => {
    expect(shouldEnableRule(undefined, ["react-jsx-only"], reactCapabilities, noIgnoredTags)).toBe(
      true,
    );
  });

  it("keeps a framework-agnostic rule (no requires, no react tag) enabled without React", () => {
    expect(shouldEnableRule(undefined, ["security"], noReactCapabilities, noIgnoredTags)).toBe(
      true,
    );
  });

  it("disables a rule that explicitly requires `react` on a non-React project", () => {
    expect(shouldEnableRule(["react"], undefined, noReactCapabilities, noIgnoredTags)).toBe(false);
    expect(shouldEnableRule(["react"], undefined, reactCapabilities, noIgnoredTags)).toBe(true);
  });
});
