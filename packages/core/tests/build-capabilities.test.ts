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
  mobxVersion: null,
  mobxMajorVersion: null,
  hasMobxReact: false,
  hasMobxReactLite: false,
  hasMobxStateTree: false,
  hasMobxReactObserver: false,
  zustandVersion: null,
  zustandMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  valtioVersion: null,
  valtioMajorVersion: null,
  hasRemotion: false,
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
  it("emits the remotion capability without replacing the web framework capability", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      framework: "vite",
      hasRemotion: true,
      remotionVersion: "^4.0.0",
      remotionMajorVersion: 4,
    });
    expect(capabilities.has("remotion")).toBe(true);
    expect(capabilities.has("remotion:4")).toBe(true);
    expect(capabilities.has("vite")).toBe(true);
  });

  it("omits the Remotion v4 capability for older or unparseable versions", () => {
    const remotionThreeCapabilities = buildCapabilities({
      ...baseProject,
      hasRemotion: true,
      remotionVersion: "^3.3.0",
      remotionMajorVersion: 3,
    });
    const unknownRemotionCapabilities = buildCapabilities({
      ...baseProject,
      hasRemotion: true,
      remotionVersion: "workspace:*",
      remotionMajorVersion: null,
    });

    expect(remotionThreeCapabilities.has("remotion")).toBe(true);
    expect(remotionThreeCapabilities.has("remotion:4")).toBe(false);
    expect(unknownRemotionCapabilities.has("remotion")).toBe(true);
    expect(unknownRemotionCapabilities.has("remotion:4")).toBe(false);
  });

  it("omits the remotion capability when the dependency is absent", () => {
    expect(buildCapabilities(baseProject).has("remotion")).toBe(false);
  });

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
      valtioVersion: "^2.1.4",
      valtioMajorVersion: 2,
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
      "valtio",
      "valtio:1",
      "valtio:2",
      "zod",
      "zod:4",
    ]);
  });

  it.each([
    { valtioVersion: "^1.0.0", valtioMajorVersion: 1, hasV2: false },
    { valtioVersion: "^2.1.4", valtioMajorVersion: 2, hasV2: true },
  ])(
    "emits the Valtio major ladder for $valtioVersion",
    ({ valtioVersion, valtioMajorVersion, hasV2 }) => {
      const capabilities = buildCapabilities({
        ...baseProject,
        valtioVersion,
        valtioMajorVersion,
      });
      expect(capabilities.has("valtio")).toBe(true);
      expect(capabilities.has("valtio:1")).toBe(true);
      expect(capabilities.has("valtio:2")).toBe(hasV2);
    },
  );

  it("keeps an unparseable Valtio declaration present but omits version capabilities", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      valtioVersion: "workspace:*",
      valtioMajorVersion: null,
    });
    expect(capabilities.has("valtio")).toBe(true);
    expect(capabilities.has("valtio:1")).toBe(false);
  });

  it("omits the `valtio` capability when project facts say the library is absent", () => {
    expect(buildCapabilities(baseProject).has("valtio")).toBe(false);
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

  it("emits the supported MobX major ladder for versions 4 through 6", () => {
    for (const mobxMajorVersion of [4, 5, 6]) {
      const capabilities = buildCapabilities({
        ...baseProject,
        mobxVersion: `^${mobxMajorVersion}.0.0`,
        mobxMajorVersion,
      });
      expect(capabilities.has("mobx")).toBe(true);
      expect(capabilities.has("mobx:4")).toBe(true);
      expect(capabilities.has(`mobx:${mobxMajorVersion}`)).toBe(true);
    }

    const futureVersion = buildCapabilities({
      ...baseProject,
      mobxVersion: "^7.0.0",
      mobxMajorVersion: 7,
    });
    expect(futureVersion.has("mobx")).toBe(true);
    expect(futureVersion.has("mobx:4")).toBe(false);
  });

  it("keeps unparseable MobX declarations present but version-inapplicable", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "workspace:*",
      mobxMajorVersion: null,
    });
    expect(capabilities.has("mobx")).toBe(true);
    expect(capabilities.has("mobx:4")).toBe(false);
  });

  it("emits binding capabilities without inventing a MobX core version", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      hasMobxReact: true,
      hasMobxReactLite: true,
      hasMobxStateTree: true,
      hasMobxReactObserver: true,
    });
    expect(capabilities.has("mobx")).toBe(true);
    expect(capabilities.has("mobx-react")).toBe(true);
    expect(capabilities.has("mobx-react-lite")).toBe(true);
    expect(capabilities.has("mobx-react-binding")).toBe(true);
    expect(capabilities.has("mobx-state-tree")).toBe(true);
    expect(capabilities.has("mobx-react-observer")).toBe(true);
    expect(capabilities.has("mobx:4")).toBe(false);
  });

  it("emits the shared React binding capability for both official runtime bindings", () => {
    for (const projectOverrides of [{ hasMobxReact: true }, { hasMobxReactLite: true }]) {
      expect(
        buildCapabilities({ ...baseProject, ...projectOverrides }).has("mobx-react-binding"),
      ).toBe(true);
    }

    expect(buildCapabilities(baseProject).has("mobx-react-binding")).toBe(false);
    expect(
      buildCapabilities({ ...baseProject, hasMobxStateTree: true }).has("mobx-react-binding"),
    ).toBe(false);
    expect(
      buildCapabilities({ ...baseProject, hasMobxReactObserver: true }).has("mobx-react-binding"),
    ).toBe(false);
  });

  it("emits the supported Zustand major ladder for versions 1 through 5", () => {
    for (const zustandMajorVersion of [1, 2, 3, 4, 5]) {
      const capabilities = buildCapabilities({
        ...baseProject,
        zustandVersion: `^${zustandMajorVersion}.0.0`,
        zustandMajorVersion,
      });
      expect(capabilities.has("zustand")).toBe(true);
      expect(capabilities.has("zustand:1")).toBe(true);
      expect(capabilities.has(`zustand:${zustandMajorVersion}`)).toBe(true);
    }

    const futureVersion = buildCapabilities({
      ...baseProject,
      zustandVersion: "^6.0.0",
      zustandMajorVersion: 6,
    });
    expect(futureVersion.has("zustand")).toBe(true);
    expect(futureVersion.has("zustand:1")).toBe(false);
  });

  it("keeps unparseable Zustand declarations present but version-inapplicable", () => {
    const capabilities = buildCapabilities({
      ...baseProject,
      zustandVersion: "workspace:*",
      zustandMajorVersion: null,
    });
    expect(capabilities.has("zustand")).toBe(true);
    expect(capabilities.has("zustand:1")).toBe(false);
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

describe("shouldEnableRule MobX gating", () => {
  const noIgnoredTags = new Set<string>();

  it("keeps MobX 6 rules off on MobX 5 and unknown future versions", () => {
    const mobx5Capabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "^5.15.0",
      mobxMajorVersion: 5,
    });
    const mobx6Capabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "^6.16.1",
      mobxMajorVersion: 6,
    });
    const futureMobxCapabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "^7.0.0",
      mobxMajorVersion: 7,
    });

    expect(shouldEnableRule(["mobx:6"], undefined, mobx5Capabilities, noIgnoredTags)).toBe(false);
    expect(shouldEnableRule(["mobx:6"], undefined, mobx6Capabilities, noIgnoredTags)).toBe(true);
    expect(shouldEnableRule(["mobx:6"], undefined, futureMobxCapabilities, noIgnoredTags)).toBe(
      false,
    );
  });

  it("requires both a supported MobX core and the matching React binding", () => {
    const mobxReactLiteCapabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "^6.16.1",
      mobxMajorVersion: 6,
      hasMobxReactLite: true,
    });
    const coreOnlyCapabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: "^6.16.1",
      mobxMajorVersion: 6,
    });
    const bindingOnlyCapabilities = buildCapabilities({
      ...baseProject,
      mobxVersion: null,
      mobxMajorVersion: null,
      hasMobxReactLite: true,
    });

    expect(
      shouldEnableRule(
        ["mobx:4", "mobx-react-binding", "react"],
        undefined,
        mobxReactLiteCapabilities,
        noIgnoredTags,
      ),
    ).toBe(true);
    expect(
      shouldEnableRule(
        ["mobx:4", "mobx-react-binding", "react"],
        undefined,
        coreOnlyCapabilities,
        noIgnoredTags,
      ),
    ).toBe(false);
    expect(
      shouldEnableRule(
        ["mobx:4", "mobx-react-binding", "react"],
        undefined,
        bindingOnlyCapabilities,
        noIgnoredTags,
      ),
    ).toBe(false);
    expect(
      shouldEnableRule(
        ["mobx:4", "mobx-react", "react"],
        undefined,
        mobxReactLiteCapabilities,
        noIgnoredTags,
      ),
    ).toBe(false);
  });
});
