import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const run = (code: string, filename = "src/components/animated-background-image.tsx") =>
  runRule(noUnguardedBrowserGlobalInRenderOrHookInit, code, {
    filename,
  });

describe("no-unguarded-browser-global-in-render-or-hook-init — server snapshots", () => {
  it.each([
    [
      "the authentic hydration Hook",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useHydrated = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const hydrated = useHydrated();
          return hydrated && document.createElement("video").canPlayType("video/mp4");
        };
      `,
    ],
    [
      "a neutrally named local Hook",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          return serverReady && document.createElement("video").canPlayType("video/mp4");
        };
      `,
    ],
    [
      "a direct named-import call",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};

        export const AnimatedBackgroundImage = () => {
          const serverReady = useSyncExternalStore(subscribe, () => true, () => false);
          return serverReady && document.title;
        };
      `,
    ],
    [
      "a renamed React import",
      `
        import { useSyncExternalStore as useStoreSnapshot } from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          useStoreSnapshot(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          return serverReady ? document.title : null;
        };
      `,
    ],
    [
      "an aliased React namespace and server snapshot callback",
      `
        import * as React from "react";

        const ReactRuntime = React;
        const subscribe = () => () => {};
        const readServerSnapshot = () => false;
        const serverSnapshot = readServerSnapshot;
        const useServerReady = () =>
          ReactRuntime.useSyncExternalStore(subscribe, () => true, serverSnapshot);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          if (!serverReady) return null;
          return document.title;
        };
      `,
    ],
    [
      "multi-hop immutable return aliases and TypeScript wrappers",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useServerReady = () => {
          const snapshot = useSyncExternalStore(
            subscribe,
            () => true,
            (() => false) satisfies () => boolean,
          );
          const firstAlias = snapshot;
          const secondAlias = firstAlias as boolean;
          return secondAlias;
        };

        export const AnimatedBackgroundImage = () => {
          const snapshot = useServerReady();
          const serverReady = snapshot;
          return !serverReady || document.title;
        };
      `,
    ],
    [
      "a false snapshot dominating an if branch",
      `
        import React from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          React.useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          if (serverReady) return document.title;
          return null;
        };
      `,
    ],
    [
      "the authentic multi-conjunct render guard",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useHydrated = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = ({ src, videoMime, failedMediaKey, mediaKey }) => {
          const hydrated = useHydrated();
          return !!src && !!videoMime && hydrated && failedMediaKey !== mediaKey &&
            document.createElement("video").canPlayType(videoMime) !== "";
        };
      `,
    ],
  ])("stays quiet for %s with a false server snapshot", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "a misleading hydration name with a true server snapshot",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useHydrated = () =>
          useSyncExternalStore(subscribe, () => true, () => true);

        export const AnimatedBackgroundImage = () => {
          const hydrated = useHydrated();
          return hydrated && document.createElement("video").canPlayType("video/mp4");
        };
      `,
    ],
    [
      "an opaque imported Hook",
      `
        import { useHydrated } from "./use-hydrated";

        export const AnimatedBackgroundImage = () => {
          const hydrated = useHydrated();
          return hydrated && document.createElement("video").canPlayType("video/mp4");
        };
      `,
    ],
    [
      "a dynamic server snapshot",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};

        export const AnimatedBackgroundImage = ({ serverReady }) => {
          const hydrated = useSyncExternalStore(subscribe, () => true, () => serverReady);
          return hydrated && document.title;
        };
      `,
    ],
    [
      "a missing server snapshot",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};

        export const AnimatedBackgroundImage = () => {
          const hydrated = useSyncExternalStore(subscribe, () => true);
          return hydrated && document.title;
        };
      `,
    ],
    [
      "a shadowed userland useSyncExternalStore",
      `
        const useSyncExternalStore = (...arguments_) => arguments_[2]();

        export const AnimatedBackgroundImage = () => {
          const hydrated = useSyncExternalStore(() => {}, () => true, () => false);
          return hydrated && document.title;
        };
      `,
    ],
    [
      "a reassigned snapshot result",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};

        export const AnimatedBackgroundImage = () => {
          let serverReady = useSyncExternalStore(subscribe, () => true, () => false);
          serverReady = true;
          return serverReady && document.title;
        };
      `,
    ],
    [
      "a reassigned local Hook",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        let useServerReady = () =>
          useSyncExternalStore(subscribe, () => true, () => false);
        useServerReady = () => true;

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          return serverReady && document.title;
        };
      `,
    ],
    [
      "the inverse OR branch",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          return serverReady || document.title;
        };
      `,
    ],
    [
      "the false ternary branch",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          return serverReady ? null : document.title;
        };
      `,
    ],
    [
      "an inverse if branch",
      `
        import { useSyncExternalStore } from "react";

        const subscribe = () => () => {};
        const useServerReady = () =>
          useSyncExternalStore(subscribe, () => true, () => false);

        export const AnimatedBackgroundImage = () => {
          const serverReady = useServerReady();
          if (!serverReady) return document.title;
          return null;
        };
      `,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a browser read is deferred regardless of the snapshot", () => {
    const result = run(`
      import { useSyncExternalStore } from "react";

      const subscribe = () => () => {};

      export const AnimatedBackgroundImage = () => {
        const serverReady = useSyncExternalStore(subscribe, () => true, () => true);
        setTimeout(() => serverReady && document.title, 0);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("no-unguarded-browser-global-in-render-or-hook-init — imported server snapshots", () => {
  let temporaryDirectory = "";
  let componentFilename = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-server-snapshot-"));
    componentFilename = path.join(
      temporaryDirectory,
      "src",
      "components",
      "animated-background-image.tsx",
    );
    fs.mkdirSync(path.dirname(componentFilename), { recursive: true });
    fs.writeFileSync(
      path.join(temporaryDirectory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    __clearParseSourceFileCacheForTests();
    __clearTsconfigAliasCacheForTests();
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  const writeFixtureFile = (relativePath: string, source: string): void => {
    const filename = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  };

  const runImportedHook = (importStatement: string, call = "useHydrated()") => {
    const source = `
      ${importStatement}

      export const AnimatedBackgroundImage = () => {
        const hydrated = ${call};
        return hydrated && document.createElement("video").canPlayType("video/mp4");
      };
    `;
    fs.writeFileSync(componentFilename, source);
    return run(source, componentFilename);
  };

  const falseSnapshotHook = `
    import { useSyncExternalStore } from "react";
    const subscribe = () => () => {};
    export function useHydrated() {
      return useSyncExternalStore(subscribe, () => true, () => false);
    }
  `;

  it.each([
    ["the authentic tsconfig alias", "@/hooks/useHydrated"],
    ["a relative named import", "../hooks/useHydrated"],
  ])("stays quiet for %s", (_name, importSource) => {
    writeFixtureFile("src/hooks/useHydrated.ts", falseSnapshotHook);
    const result = runImportedHook(`import { useHydrated } from "${importSource}";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a default export", () => {
    writeFixtureFile(
      "src/hooks/useHydrated.ts",
      `
        import { useSyncExternalStore } from "react";
        const subscribe = () => () => {};
        export default () =>
          useSyncExternalStore(subscribe, () => true, () => false);
      `,
    );
    const result = runImportedHook(`import useHydrated from "@/hooks/useHydrated";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet through one uniquely resolved barrel", () => {
    writeFixtureFile("src/hooks/use-hydrated.ts", falseSnapshotHook);
    writeFixtureFile("src/hooks/index.ts", `export { useHydrated } from "./use-hydrated";`);
    const result = runImportedHook(`import { useHydrated } from "@/hooks";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not follow a tsconfig alias into node_modules", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@vendor": ["node_modules/hydration-library/index.ts"] },
        },
      }),
    );
    writeFixtureFile("node_modules/hydration-library/index.ts", falseSnapshotHook);
    __clearTsconfigAliasCacheForTests();
    const result = runImportedHook(`import { useHydrated } from "@vendor";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a bare package",
      () => {},
      `import { useHydrated } from "hydration-library";`,
      "useHydrated()",
    ],
    [
      "an ambiguous barrel",
      () => {
        writeFixtureFile("src/hooks/first.ts", falseSnapshotHook);
        writeFixtureFile("src/hooks/second.ts", falseSnapshotHook);
        writeFixtureFile(
          "src/hooks/index.ts",
          `export * from "./first"; export * from "./second";`,
        );
      },
      `import { useHydrated } from "@/hooks";`,
      "useHydrated()",
    ],
    [
      "a cyclic barrel",
      () => {
        writeFixtureFile("src/hooks/first.ts", `export { useHydrated } from "./second";`);
        writeFixtureFile("src/hooks/second.ts", `export { useHydrated } from "./first";`);
      },
      `import { useHydrated } from "@/hooks/first";`,
      "useHydrated()",
    ],
    [
      "a true server snapshot",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          falseSnapshotHook.replace("() => false", "() => true"),
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
    [
      "a dynamic server snapshot",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "react";
            const subscribe = () => () => {};
            const serverReady = Math.random() > 0.5;
            export const useHydrated = () =>
              useSyncExternalStore(subscribe, () => true, () => serverReady);
          `,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
    [
      "a missing server snapshot",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "react";
            const subscribe = () => () => {};
            export const useHydrated = () => useSyncExternalStore(subscribe, () => true);
          `,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
    [
      "a mutable exported Hook",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "react";
            const subscribe = () => () => {};
            export let useHydrated = () =>
              useSyncExternalStore(subscribe, () => true, () => false);
            useHydrated = () => true;
          `,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
    [
      "a Hook with multiple returns",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "react";
            const subscribe = () => () => {};
            export const useHydrated = () => {
              if (Math.random() > 0.5) return true;
              return useSyncExternalStore(subscribe, () => true, () => false);
            };
          `,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
    [
      "a parameter-dependent Hook",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "react";
            const subscribe = () => () => {};
            export const useHydrated = (enabled) =>
              enabled && useSyncExternalStore(subscribe, () => true, () => false);
          `,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated(true)",
    ],
    [
      "a userland external-store function",
      () => {
        writeFixtureFile(
          "src/hooks/useHydrated.ts",
          `
            import { useSyncExternalStore } from "./external-store";
            const subscribe = () => () => {};
            export const useHydrated = () =>
              useSyncExternalStore(subscribe, () => true, () => false);
          `,
        );
        writeFixtureFile(
          "src/hooks/external-store.ts",
          `export const useSyncExternalStore = (...arguments_) => arguments_[2]();`,
        );
      },
      `import { useHydrated } from "@/hooks/useHydrated";`,
      "useHydrated()",
    ],
  ])("reports %s", (_name, installFixture, importStatement, call) => {
    installFixture();
    const result = runImportedHook(importStatement, call);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
