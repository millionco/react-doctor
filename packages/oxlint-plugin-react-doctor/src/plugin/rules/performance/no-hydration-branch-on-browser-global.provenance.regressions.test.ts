import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

const run = (code: string) =>
  runRule(noHydrationBranchOnBrowserGlobal, code, { filename: "app/background.tsx" });

describe("no-hydration-branch-on-browser-global — helper provenance", () => {
  it("reports the Jumper browser capability helper through useMemo", () => {
    const result = run(`
      "use client";
      import { useMemo, useState } from "react";
      const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);
      const isVideoCandidateMime = (mime: string) => VIDEO_MIME_TYPES.has(mime);
      const isPlayableVideo = (mime: string) => {
        if (typeof document === "undefined") return false;
        return ["maybe", "probably"].includes(
          document.createElement("video").canPlayType(mime),
        );
      };
      export const Background = ({ src, mime }) => {
        const [failed, setFailed] = useState(false);
        const playable = useMemo(
          () => isVideoCandidateMime(mime) && isPlayableVideo(mime),
          [mime],
        );
        return Boolean(src) && playable && !failed
          ? <video src={src} onError={() => setFailed(true)} />
          : <Image src={src} />;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a direct local helper",
      `
        "use client";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => isBrowser() ? <Client /> : <Server />;
      `,
    ],
    [
      "immutable helper and hook aliases",
      `
        "use client";
        import { useMemo } from "react";
        const browserCheck = () => typeof document !== "undefined";
        const browserCheckAlias = browserCheck;
        const memoize = useMemo;
        export const Page = () => {
          const isBrowser = memoize(() => browserCheckAlias(), []);
          return isBrowser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a React namespace useMemo callback",
      `
        "use client";
        import * as React from "react";
        function canUseBrowser() {
          if (typeof window === "undefined") return false;
          return supportsRequiredFeature(window);
        }
        export const Page = () => {
          const canRender = React.useMemo(canUseBrowser, []);
          return canRender ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a rendered attribute branch",
      `
        "use client";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => (
          <main data-runtime={isBrowser() ? "client" : "server"} />
        );
      `,
    ],
    [
      "combined local helpers and useMemo wrappers",
      `
        "use client";
        import { useMemo } from "react";
        const hasWindow = () => typeof window !== "undefined";
        const hasDocument = () => typeof document !== "undefined";
        export const Page = () => {
          const canUseWindow = useMemo(hasWindow, []);
          const canUseDocument = useMemo(hasDocument, []);
          return canUseWindow && canUseDocument ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a client-varying helper beside a direct browser predicate",
      `
        "use client";
        const isClient = () => {
          if (typeof window === "undefined") {
            if (false) return true;
            return false;
          }
          if (false) return false;
          return true;
        };
        export const Page = () =>
          isClient() && typeof document !== "undefined" ? <Client /> : <Server />;
      `,
    ],
    [
      "shadowed helper return bindings",
      `
        "use client";
        const isClient = () => {
          if (typeof window !== "undefined") {
            const available = true;
            return available;
          }
          const available = false;
          return available;
        };
        export const Page = () => isClient() ? <Client /> : <Server />;
      `,
    ],
  ])("reports browser-global provenance through %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an effect-only helper result",
      `
        "use client";
        import { useEffect } from "react";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => {
          useEffect(() => log(isBrowser()), []);
          return <Server />;
        };
      `,
    ],
    [
      "an event-only helper result",
      `
        "use client";
        const isBrowser = () => typeof document !== "undefined";
        export const Page = () => <button onClick={() => log(isBrowser())}>check</button>;
      `,
    ],
    [
      "a helper result that does not select output",
      `
        "use client";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => {
          const browser = isBrowser();
          log(browser);
          return <Server />;
        };
      `,
    ],
    [
      "structurally equivalent rendered branches",
      `
        "use client";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => isBrowser() ? <Same /> : <Same />;
      `,
    ],
    [
      "a false-initialized mounted condition gate",
      `
        "use client";
        import { useMemo, useState } from "react";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => {
          const [mounted] = useState(false);
          const browser = useMemo(isBrowser, []);
          return mounted && browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a false-initialized mounted early return",
      `
        "use client";
        import { useMemo, useState } from "react";
        const isBrowser = () => typeof document !== "undefined";
        export const Page = () => {
          const [mounted] = useState(false);
          const browser = useMemo(isBrowser, []);
          if (!mounted) return <Server />;
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser guard whose return paths are equivalent",
      `
        "use client";
        const isBrowser = () => {
          if (typeof window === "undefined") return false;
          return false;
        };
        export const Page = () => isBrowser() ? <Client /> : <Server />;
      `,
    ],
    [
      "a browser check that does not control the helper return",
      `
        "use client";
        const isBrowser = () => {
          if (typeof document === "undefined") log("server");
          return false;
        };
        export const Page = () => isBrowser() ? <Client /> : <Server />;
      `,
    ],
    [
      "equivalent multi-return helper branches",
      `
        "use client";
        const canRender = (enabled) => {
          if (typeof window !== "undefined") {
            if (enabled) return true;
            return false;
          }
          if (enabled) return true;
          return false;
        };
        export const Page = ({ enabled }) =>
          canRender(enabled) ? <Client /> : <Server />;
      `,
    ],
    [
      "a statically disabled helper parameter gate",
      `
        "use client";
        const isBrowser = (enabled) => enabled && typeof window !== "undefined";
        export const Page = () => isBrowser(false) ? <Client /> : <Server />;
      `,
    ],
    [
      "a shadowed document helper parameter",
      `
        "use client";
        const isBrowser = (document) => typeof document !== "undefined";
        export const Page = ({ environment }) =>
          isBrowser(environment) ? <Client /> : <Server />;
      `,
    ],
    [
      "a userland useMemo lookalike",
      `
        "use client";
        const useMemo = (_callback) => false;
        export const Page = () => {
          const browser = useMemo(() => typeof document !== "undefined");
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a lookalike useMemo import",
      `
        "use client";
        import { useMemo } from "not-react";
        export const Page = () => {
          const browser = useMemo(() => typeof window !== "undefined", []);
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "an imported browser helper",
      `
        "use client";
        import { isBrowser } from "./environment";
        export const Page = () => isBrowser() ? <Client /> : <Server />;
      `,
    ],
    [
      "a mutable local result",
      `
        "use client";
        const isBrowser = () => typeof window !== "undefined";
        export const Page = () => {
          let browser = isBrowser();
          browser = false;
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "combined complementary helper predicates",
      `
        "use client";
        import { useMemo } from "react";
        const isBrowser = () => typeof window !== "undefined";
        const isServer = () => typeof window === "undefined";
        export const Page = () => {
          const browser = useMemo(isBrowser, []);
          const server = useMemo(isServer, []);
          return browser && server ? <Client /> : <Server />;
        };
      `,
    ],
  ])("stays quiet for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
