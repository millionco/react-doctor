import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const run = (code: string) =>
  runRule(noUnguardedBrowserGlobalInRenderOrHookInit, code, {
    filename: "src/components/animated-background-image.tsx",
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
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
