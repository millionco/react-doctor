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
      "useMemo object property access",
      `
        import { useMemo } from "react";
        export const Background = () => {
          const playable = useMemo(() => {
            let result = false;
            if (typeof document !== "undefined") result = true;
            return { playable: result };
          }, []).playable;
          return playable ? <video /> : <img alt="" />;
        };
      `,
    ],
    [
      "local rendered custom-hook state",
      `
        import { useState } from "react";
        export const useRegistration = () => {
          const [registration] = useState(
            typeof window === "undefined" ? { type: "primary" } : null,
          );
          return { registration };
        };
        export const Page = () => {
          const { registration } = useRegistration();
          return registration ? <Primary /> : <Pending />;
        };
      `,
    ],
    [
      "direct custom-hook state return",
      `
        import { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return runtime;
        };
        export const Page = () => {
          const runtime = useRuntime();
          return runtime ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "tuple custom-hook state return",
      `
        import { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return [runtime] as const;
        };
        export const Page = () => {
          const [runtime] = useRuntime();
          return runtime ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "custom-hook result member consumer",
      `
        import { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const result = useRuntime();
          return result.runtime ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "aliased custom-hook result member consumer",
      `
        import { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const result = useRuntime();
          const mode = result.runtime;
          return mode ? <Client /> : <Server />;
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
      "a browser branch inside a directly rendered local helper",
      `
        import React from "react";
        const renderContent = () =>
          typeof window !== "undefined" ? <Client /> : <Server />;
        export const Page = () => <div>{renderContent()}</div>;
      `,
    ],
    [
      "a createElement lookalike rendered by React",
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
      "a shadowed React factory returned by a component",
      `
        import { useState } from "react";
        const React = {
          createElement: (value) => value === "server" ? "server" : "client",
        };
        export const Page = () => {
          useState(false);
          return typeof window === "undefined"
            ? React.createElement("server")
            : React.createElement("client");
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
      "a custom hook state value returned without a local rendered consumer",
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
      "an unused local render helper",
      `
        import React from "react";
        export const Page = () => {
          const renderContent = () =>
            typeof window !== "undefined" ? <Client /> : <Server />;
          log(renderContent);
          return <Stable />;
        };
      `,
    ],
    [
      "a stored state-writing callback",
      `
        import React from "react";
        export const Page = () => {
          let show = false;
          const enable = () => {
            show = true;
          };
          if (typeof window !== "undefined") log(enable);
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser-guarded helper write preserving the initial value",
      `
        import React from "react";
        export const Page = () => {
          let show = false;
          const preserve = () => {
            show = false;
          };
          if (typeof window !== "undefined") preserve();
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a createElement lookalike",
      `
        import React from "react";
        const renderer = { createElement: () => "not React" };
        export const Page = () => {
          const metadata =
            typeof window === "undefined"
              ? renderer.createElement("server")
              : renderer.createElement("client");
          log(metadata);
          return React.createElement("main", null, "stable");
        };
      `,
    ],
    [
      "a shadowed React namespace",
      `
        import { useState } from "react";
        const React = { createElement: () => "not React" };
        export const Page = () => {
          useState(false);
          const metadata = typeof window === "undefined"
            ? React.createElement("server")
            : React.createElement("client");
          log(metadata);
          return <Stable />;
        };
      `,
    ],
    [
      "equal duplicated browser predicates",
      `
        import React from "react";
        export const Page = () => {
          const stable =
            (typeof window === "undefined") ===
            (typeof window === "undefined");
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "unequal duplicated browser predicates",
      `
        import React from "react";
        export const Page = () => {
          const stable =
            (typeof window === "undefined") !==
            (typeof window === "undefined");
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "nested equal duplicated browser comparisons",
      `
        import React from "react";
        export const Page = () => {
          const stable =
            ((typeof window === "undefined") === true) ===
            ((typeof window === "undefined") === true);
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    ...[["0"], ['""'], ["null"], ["undefined"]].map(([value]) => [
      `strict browser predicate comparison with ${value}`,
      `
        import React from "react";
        export const Page = () => {
          const stable = (typeof window === "undefined") === ${value};
          return stable ? <Same /> : <Different />;
        };
      `,
    ]),
    [
      "a browser predicate masked by bitwise and",
      `
        import React from "react";
        export const Page = () => {
          const stable = (typeof window === "undefined") & 0;
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "inverse browser predicates combined by bitwise or",
      `
        import React from "react";
        export const Page = () => {
          const stable =
            (typeof window === "undefined") |
            (typeof window !== "undefined");
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "equal aliased browser predicates",
      `
        import React from "react";
        export const Page = () => {
          const isServer = typeof window === "undefined";
          const stable = isServer === isServer;
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "a strict browser predicate comparison with an aliased zero",
      `
        import React from "react";
        export const Page = () => {
          const zero = 0;
          const stable = (typeof window === "undefined") === zero;
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "equal boolean aliases of a browser predicate",
      `
        import React from "react";
        export const Page = () => {
          const isServer = typeof window === "undefined";
          const serverAlias = isServer;
          const stable = serverAlias === isServer;
          return stable ? <Same /> : <Different />;
        };
      `,
    ],
    ...["===", "!=="].map((operator) => [
      `mutable browser alias self-${operator === "===" ? "equality" : "inequality"}`,
      `
        import React from "react";
        export const Page = () => {
          let isServer = false;
          if (typeof window === "undefined") isServer = true;
          const stable = isServer ${operator} isServer;
          return stable ? <Same /> : <Different />;
        };
      `,
    ]),
  ])("stays quiet for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "a dynamically nested browser write",
      `
        import React from "react";
        export const Page = ({ enabled }) => {
          let show = false;
          if (typeof window !== "undefined") {
            if (enabled) show = true;
          }
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser-guarded local helper invocation that writes rendered state",
      `
        import React from "react";
        export const Page = () => {
          let show = false;
          const enable = () => {
            show = true;
          };
          if (typeof window !== "undefined") enable();
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "unrelated browser-derived values compared for equality",
      `
        import React from "react";
        export const Page = () => {
          const client =
            typeof window !== "undefined" ? readClientFlag() : false;
          const server =
            typeof window === "undefined" ? readServerFlag() : false;
          return client === server ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "a browser-derived possible NaN compared with itself",
      `
        import React from "react";
        export const Page = () => {
          const value =
            typeof window !== "undefined" ? Number("x") : 0;
          return value === value ? <Same /> : <Different />;
        };
      `,
    ],
    [
      "a browser predicate in a dynamically selected conditional arm",
      `
        import React from "react";
        export const Page = ({ enabled }) => {
          const value =
            enabled ? typeof window !== "undefined" : false;
          return value ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser write from a shadowed same-name binding",
      `
        import React from "react";
        export const Page = () => {
          const value = false;
          let show = value;
          if (typeof window !== "undefined") {
            const value = true;
            show = value;
          }
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    ...["false", "reset"].map((condition) => [
      `a browser write followed by a ${condition} conditional overwrite`,
      `
        import React from "react";
        export const Page = ({ reset }) => {
          let show = false;
          if (typeof window !== "undefined") show = true;
          if (${condition}) show = false;
          return show ? <Client /> : <Server />;
        };
      `,
    ]),
    [
      "shadowed branch-local return conditions",
      `
        import React from "react";
        export const Page = () => {
          if (typeof window !== "undefined") {
            const ready = true;
            if (ready) return <Primary />;
            return <Fallback />;
          } else {
            const ready = false;
            if (ready) return <Primary />;
            return <Fallback />;
          }
        };
      `,
    ],
    [
      "shadowed JSX child bindings",
      `
        import React from "react";
        export const Page = () => {
          if (typeof window !== "undefined") {
            const label = "client";
            return <div>{label}</div>;
          } else {
            const label = "server";
            return <div>{label}</div>;
          }
        };
      `,
    ],
    [
      "shadowed JSX attribute bindings",
      `
        import React from "react";
        export const Page = () => {
          if (typeof window !== "undefined") {
            const label = "client";
            return <div title={label} />;
          } else {
            const label = "server";
            return <div title={label} />;
          }
        };
      `,
    ],
    [
      "a structurally rendered suppressed custom-hook value",
      `
        import React, { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const { runtime } = useRuntime();
          return (
            <span suppressHydrationWarning>
              {runtime ? <Client /> : <Server />}
            </span>
          );
        };
      `,
    ],
  ])("reports adversarial %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a statically unreachable browser write",
      `
        import React from "react";
        export const Page = () => {
          let show = false;
          if (typeof window !== "undefined") {
            if (false) show = true;
          }
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a stable property beside an unstable memo property",
      `
        import { useMemo } from "react";
        export const Page = () => {
          const stable = useMemo(() => ({
            stable: false,
            runtime: typeof window !== "undefined",
          }), []).stable;
          return stable ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "an equivalent browser-guarded memo write",
      `
        import { useMemo } from "react";
        export const Page = () => {
          const { stable } = useMemo(() => {
            let stable = false;
            if (typeof window !== "undefined") stable = false;
            return { stable };
          }, []);
          return stable ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser predicate in the dead consequent of a conditional",
      `
        import React from "react";
        export const Page = () => {
          const value =
            false ? typeof window !== "undefined" : false;
          return value ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser predicate in the dead alternate of a conditional",
      `
        import React from "react";
        export const Page = () => {
          const value =
            true ? false : typeof window !== "undefined";
          return value ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser write followed by a statically unconditional overwrite",
      `
        import React from "react";
        export const Page = () => {
          let show = false;
          if (typeof window !== "undefined") show = true;
          if (true) show = false;
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a browser write preserving the same binding",
      `
        import React from "react";
        export const Page = () => {
          const value = false;
          let show = value;
          if (typeof window !== "undefined") show = value;
          return show ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "same-binding equivalent return trees",
      `
        import React from "react";
        export const Page = () => {
          const ready = true;
          if (typeof window !== "undefined") {
            if (ready) return <Primary />;
            return <Fallback />;
          } else {
            if (ready) return <Primary />;
            return <Fallback />;
          }
        };
      `,
    ],
    [
      "same-binding equivalent JSX children and attributes",
      `
        import React from "react";
        export const Page = () => {
          const label = "same";
          if (typeof window !== "undefined") {
            return <div title={label}>{label}</div>;
          }
          return <div title={label}>{label}</div>;
        };
      `,
    ],
    [
      "a mount-gated custom-hook consumer",
      `
        import React, { useEffect, useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const { runtime } = useRuntime();
          const [mounted, setMounted] = useState(false);
          useEffect(() => setMounted(true), []);
          if (!mounted) return null;
          return runtime ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "an unused direct custom-hook state return",
      `
        import React, { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return runtime;
        };
        export const Page = () => {
          const runtime = useRuntime();
          log(runtime);
          return <Stable />;
        };
      `,
    ],
    [
      "a mount-gated tuple custom-hook consumer",
      `
        import React, { useEffect, useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return [runtime] as const;
        };
        export const Page = () => {
          const [runtime] = useRuntime();
          const [mounted, setMounted] = useState(false);
          useEffect(() => setMounted(true), []);
          if (!mounted) return null;
          return runtime ? <Client /> : <Server />;
        };
      `,
    ],
    [
      "a suppressed custom-hook member consumer",
      `
        import React, { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const result = useRuntime();
          return <span suppressHydrationWarning>{result.runtime}</span>;
        };
      `,
    ],
    [
      "suppressed custom-hook text",
      `
        import React, { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const { runtime } = useRuntime();
          return <span suppressHydrationWarning>{runtime}</span>;
        };
      `,
    ],
    [
      "suppressed custom-hook attribute",
      `
        import React, { useState } from "react";
        const useRuntime = () => {
          const [runtime] = useState(
            typeof window === "undefined" ? "server" : "client",
          );
          return { runtime };
        };
        export const Page = () => {
          const { runtime } = useRuntime();
          return <span suppressHydrationWarning title={runtime} />;
        };
      `,
    ],
  ])("stays quiet for adversarial %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["a browser predicate compared with false", `(typeof window === "undefined") === false`],
    [
      "a nested browser predicate compared with false",
      `((typeof window === "undefined") === true) === false`,
    ],
    ["a browser predicate loosely compared with zero", `(typeof window === "undefined") == 0`],
    [
      "a Boolean-wrapped browser predicate compared with false",
      `Boolean(typeof window === "undefined") === false`,
    ],
    [
      "an aliased browser predicate compared with false",
      `(() => {
        const isServer = typeof window === "undefined";
        return isServer === false;
      })()`,
    ],
  ])("reports %s", (_name, condition) => {
    const result = run(`
      import React from "react";
      export const Page = () => {
        const unstable = ${condition};
        return unstable ? <Client /> : <Server />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an as-wrapped rendered local helper",
      `const renderContent = (() =>
        typeof window !== "undefined" ? <Client /> : <Server />
      ) as () => React.ReactNode;`,
    ],
    [
      "a satisfies-wrapped rendered local helper",
      `const renderContent = (() =>
        typeof window !== "undefined" ? <Client /> : <Server />
      ) satisfies () => React.ReactNode;`,
    ],
  ])("reports %s", (_name, helperDeclaration) => {
    const result = run(`
      import React from "react";
      ${helperDeclaration}
      export const Page = () => <main>{renderContent()}</main>;
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a nested uninvoked browser-guarded writer", () => {
    const result = run(`
      import React from "react";
      export const Page = () => {
        const visible = React.useMemo(() => {
          let nextVisible = false;
          if (typeof window !== "undefined") {
            const neverRun = () => {
              nextVisible = true;
            };
          }
          return nextVisible;
        }, []);
        return visible ? <Client /> : <Server />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a nested invoked browser-guarded writer", () => {
    const result = run(`
      import React from "react";
      export const Page = () => {
        const visible = React.useMemo(() => {
          let nextVisible = false;
          if (typeof window !== "undefined") {
            const enable = () => {
              nextVisible = true;
            };
            enable();
          }
          return nextVisible;
        }, []);
        return visible ? <Client /> : <Server />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
