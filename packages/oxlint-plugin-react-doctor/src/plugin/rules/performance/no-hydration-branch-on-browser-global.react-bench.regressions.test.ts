import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

const run = (code: string, filename = "src/background.tsx") =>
  runRule(noHydrationBranchOnBrowserGlobal, code, { filename });

describe("no-hydration-branch-on-browser-global — ReactBench regressions", () => {
  it.each([
    [
      "try/catch return flow",
      `
        import { useMemo } from "react";
        export const Background = ({ candidate }) => {
          const playable = useMemo(() => {
            if (!candidate) return false;
            if (typeof document === "undefined") return false;
            try {
              return document.createElement("video").canPlayType("video/mp4") !== "";
            } catch {
              return false;
            }
          }, [candidate]);
          return playable ? <video /> : <img alt="" />;
        };
      `,
    ],
    [
      "mutable render state",
      `
        import { useState } from "react";
        export const Background = ({ candidate }) => {
          const [failed] = useState(false);
          let playable = candidate;
          if (candidate && typeof document !== "undefined") {
            if (!document.createElement("video").canPlayType("video/mp4")) playable = false;
          }
          return playable && !failed ? <video /> : <img alt="" />;
        };
      `,
    ],
    [
      "useMemo object return",
      `
        import { useMemo } from "react";
        export const Background = ({ candidate }) => {
          const { playable } = useMemo(() => {
            let result = false;
            if (candidate && typeof document !== "undefined") result = true;
            return { playable: result };
          }, [candidate]);
          return playable ? <video /> : <img alt="" />;
        };
      `,
    ],
    [
      "returned custom-hook state",
      `
        import { useState } from "react";
        export const useRegistration = () => {
          const [registration] = useState(
            typeof window === "undefined" ? { type: "primary" } : null,
          );
          return { registration };
        };
      `,
    ],
    [
      "hookless imported React component",
      `
        import React from "react";
        export const Skeleton = ({ registered }) => (
          <main>{typeof window === "undefined" || registered ? <Ready /> : null}</main>
        );
      `,
    ],
    [
      "forwardRef component",
      `
        import React from "react";
        export const Skeleton = React.forwardRef(({ ready }, ref) => {
          const server = typeof window === "undefined";
          return <main ref={ref}>{ready || server ? <Ready /> : null}</main>;
        });
      `,
    ],
    [
      "local render helper",
      `
        import { useMemo } from "react";
        export const Background = () => {
          const { playable } = useMemo(() => {
            let result = false;
            if (typeof document !== "undefined") result = true;
            return { playable: result };
          }, []);
          const renderMedia = () => {
            if (playable) return <video />;
            return <img alt="" />;
          };
          return <main>{renderMedia()}</main>;
        };
      `,
    ],
    [
      "compiled createElement output",
      `
        var react_1 = require("react");
        function BreadcrumbsSlot(props) {
          var isSSR = typeof window === "undefined";
          return react_1.createElement(
            "main",
            null,
            props.breadcrumbs && !isSSR && react_1.createElement("div", null),
          );
        }
      `,
    ],
  ])("reports %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["52u5oWQ", "hasMounted", "document", "document.createElement"],
    ["8VLeaNy", "mounted", "document", "document.createElement"],
    ["HBuH2VG", "mounted", "document", "document.createElement"],
    ["NLWHX7b", "hasMounted", "window", "window.document"],
    ["tonnDnH", "mounted", "window", "window.document"],
    ["VzG9Zow", "hasMounted", "document", "document.createElement"],
  ])(
    "stays quiet for mount-gated ReactBench retraction %s",
    (_trial, mountedName, browserGlobal, browserValue) => {
      const result = run(`
        import { useMemo, useState } from "react";
        export const Background = ({ candidate }) => {
          const [${mountedName}] = useState(false);
          const playable = useMemo(() => {
            if (typeof ${browserGlobal} === "undefined") return false;
            return Boolean(${browserValue});
          }, [candidate]);
          return ${mountedName} && playable ? <video /> : <img alt="" />;
        };
      `);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    [
      "an overwritten mutable alias",
      `
        import React from "react";
        export const Page = () => {
          let browser = false;
          if (typeof window !== "undefined") browser = true;
          browser = false;
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "equivalent mutable assignments",
      `
        import React from "react";
        export const Page = () => {
          let browser = false;
          if (typeof document !== "undefined") browser = false;
          return browser ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a returned state value used only as metadata",
      `
        import { useState } from "react";
        export const useMetadata = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          log(runtime);
          return { stable: true };
        };
      `,
    ],
    [
      "a browser-guarded write unrelated to the returned symbol",
      `
        import { useMemo } from "react";
        export const Page = () => {
          const stable = useMemo(() => {
            let probe = false;
            const rendered = true;
            if (typeof document !== "undefined") probe = true;
            log(probe);
            return { rendered };
          }, []).rendered;
          return stable ? <Stable /> : null;
        };
      `,
    ],
    [
      "a lazy browser initializer whose state is never rendered",
      `
        import { useState } from "react";
        export const Page = () => {
          const [runtime] = useState(() => {
            if (typeof window === "undefined") return "server";
            return "client";
          });
          log(runtime);
          return <Stable />;
        };
      `,
    ],
    [
      "a React import in a non-component utility",
      `
        import React from "react";
        export const readRuntime = () =>
          typeof window === "undefined" ? "server" : "client";
      `,
    ],
    [
      "a local helper called outside render",
      `
        import { useEffect } from "react";
        export const Page = () => {
          const readRuntime = () =>
            typeof document === "undefined" ? "server" : "client";
          useEffect(() => log(readRuntime()), []);
          return <Stable />;
        };
      `,
    ],
    [
      "a createElement lookalike",
      `
        import React from "react";
        const renderer = { createElement: () => "not React" };
        export const Page = ({ ready }) =>
          React.createElement(
            "main",
            null,
            ready && typeof window !== "undefined" && renderer.createElement(),
          );
      `,
    ],
    [
      "a shadowed React namespace",
      `
        import { useState } from "react";
        const React = { createElement: () => "not React" };
        export const Page = () => {
          useState(false);
          return typeof window === "undefined"
            ? React.createElement("server")
            : React.createElement("client");
        };
      `,
    ],
  ])("stays quiet for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
