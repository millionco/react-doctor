import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

const run = (code: string, filename = "app/page.tsx") =>
  runRule(noHydrationBranchOnBrowserGlobal, code, { filename });

describe("no-hydration-branch-on-browser-global", () => {
  it.each([
    [
      "JSX branches",
      `"use client"; export const Page = () => typeof window === "undefined" ? <Server /> : <Client />;`,
    ],
    [
      "text branches",
      `"use client"; export const Page = () => <span>{typeof document === "undefined" ? "server" : "client"}</span>;`,
    ],
    [
      "attribute branches",
      `"use client"; export const Page = () => <div data-runtime={typeof window !== "undefined" ? "client" : "server"} />;`,
    ],
    [
      "if/else returns",
      `"use client"; export const Page = () => { if (typeof window === "undefined") return <Server />; else return <Client />; };`,
    ],
    [
      "early return followed by client return",
      `"use client"; export const Page = () => { if (typeof document === "undefined") return <Server />; return <Client />; };`,
    ],
    [
      "early return followed by setup and client return",
      `"use client"; export const Page = () => { if (typeof document === "undefined") return <Server />; const content = getContent(); return <Client content={content} />; };`,
    ],
    [
      "else-if returns",
      `"use client"; export const Page = ({ ready }) => { if (typeof window === "undefined") return <Server />; else if (ready) return <Client />; else return <Fallback />; };`,
    ],
    [
      "a later differing else-if return",
      `"use client"; export const Page = ({ ready }) => { if (typeof window === "undefined") return <Server />; else if (ready) return <Server />; else return <Client />; };`,
    ],
    [
      "logical JSX branch",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && <ClientOnly />}</main>;`,
    ],
    [
      "compound logical JSX branch",
      `"use client"; export const Page = ({ ready }) => <main>{typeof window !== "undefined" && ready && <ClientOnly />}</main>;`,
    ],
    [
      "nested logical JSX branch",
      `"use client"; export const Page = ({ ready }) => <main>{typeof window !== "undefined" && (ready && <ClientOnly />)}</main>;`,
    ],
  ])("reports different rendered output selected by %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "identical JSX",
      `"use client"; export const Page = () => typeof window === "undefined" ? <span>same</span> : <span>same</span>;`,
    ],
    [
      "an effect",
      `import { useEffect } from "react"; export const Page = () => { useEffect(() => { const value = typeof window === "undefined" ? "server" : "client"; log(value); }, []); return null; };`,
    ],
    [
      "an event handler",
      `"use client"; export const Page = () => <button onClick={() => typeof window === "undefined" ? server() : client()}>go</button>;`,
    ],
    [
      "a mounted guard",
      `"use client"; export const Page = ({ isMounted }) => <div>{isMounted && (typeof window === "undefined" ? <Server /> : <Client />)}</div>;`,
    ],
    [
      "a falsy state gate",
      `import { useState } from "react"; export const Page = () => { const [open] = useState(false); return <div>{open && (typeof window === "undefined" ? <Server /> : <Client />)}</div>; };`,
    ],
    [
      "a mounted early-return gate",
      `import { useEffect, useState } from "react"; export const Page = () => { const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); if (!mounted) return null; return typeof window === "undefined" ? <Server /> : <Client />; };`,
    ],
    [
      "a browser probe inside an OR condition that is already true",
      `"use client"; export const Page = () => { const ready = true; return <main>{(typeof window !== "undefined" || ready) && <ClientOnly />}</main>; };`,
    ],
    [
      "an unreachable return after identical branches",
      `"use client"; export const Page = () => { if (typeof window === "undefined") return <Same />; return <Same />; return <Different />; };`,
    ],
    [
      "mirrored nested return trees",
      `"use client"; export const Page = ({ ready, blocked }) => { if (typeof window === "undefined") { if (!ready && blocked === false) return <Fallback />; return <Ready />; } else { if (!ready && blocked === false) return <Fallback />; return <Ready />; } };`,
    ],
    [
      "a non-rendered local value",
      `"use client"; export const Page = () => { const runtime = typeof window === "undefined" ? "server" : "client"; log(runtime); return <div />; };`,
    ],
    [
      "a shadowed window",
      `"use client"; export const Page = ({ window }) => window === undefined ? <Server /> : <Client />;`,
    ],
    [
      "a server component without client render evidence",
      `export const Page = () => typeof window === "undefined" ? <Server /> : <Client />;`,
    ],
    [
      "a logical null branch",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && null}</main>;`,
    ],
    [
      "a logical boolean branch",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && false}</main>;`,
    ],
    [
      "a logical empty string branch",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && ""}</main>;`,
    ],
    [
      "a logical empty template branch",
      '"use client"; export const Page = () => <main>{typeof window !== "undefined" && ``}</main>;',
    ],
  ])("stays quiet for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors suppressHydrationWarning on the rendered parent", () => {
    const result = run(
      `"use client"; export const Page = () => <span suppressHydrationWarning>{typeof window === "undefined" ? "server" : "client"}</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips test, native, email, and generated-image contexts", () => {
    const code = `"use client"; export const Page = () => typeof window === "undefined" ? <Server /> : <Client />;`;
    expect(run(code, "app/page.test.tsx").diagnostics).toEqual([]);
    expect(run(code, "packages/mobile/App.native.tsx").diagnostics).toEqual([]);
    expect(
      run(
        `import { Text } from "@react-email/components"; export const Mail = () => typeof window === "undefined" ? <Text>server</Text> : <Text>client</Text>;`,
      ).diagnostics,
    ).toEqual([]);
    expect(
      run(
        `"use client"; import { ImageResponse } from "next/og"; export const Page = () => new ImageResponse(typeof window === "undefined" ? <div>server</div> : <div>client</div>);`,
      ).diagnostics,
    ).toEqual([]);
  });
});
