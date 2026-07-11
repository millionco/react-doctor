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
      "globalThis branches",
      `"use client"; export const Page = () => typeof globalThis.window === "undefined" ? <Server /> : <Client />;`,
    ],
    [
      "a client-looking prop with unsafe polarity",
      `"use client"; export const Page = ({ mounted }) => !mounted && (typeof window === "undefined" ? <Server /> : <Client />);`,
    ],
    [
      "a client-looking prop before an unsafe early return",
      `"use client"; export const Page = ({ mounted }) => { if (mounted) return null; return typeof window === "undefined" ? <Server /> : <Client />; };`,
    ],
    [
      "if/else returns",
      `"use client"; export const Page = () => { if (typeof window === "undefined") return <Server />; else return <Client />; };`,
    ],
    [
      "an if statement with a browser predicate on the right of AND",
      `"use client"; export const Page = ({ ready }) => { if (ready && typeof window !== "undefined") return <Client />; return <Server />; };`,
    ],
    [
      "an if statement with a browser predicate on the right of OR",
      `"use client"; export const Page = ({ blocked }) => { if (blocked || typeof document === "undefined") return <Server />; return <Client />; };`,
    ],
    [
      "a ternary with a browser predicate on the left of AND",
      `"use client"; export const Page = ({ ready }) => typeof window !== "undefined" && ready ? <Client /> : <Server />;`,
    ],
    [
      "a ternary with a browser predicate on the left of OR",
      `"use client"; export const Page = ({ blocked }) => typeof document === "undefined" || blocked ? <Server /> : <Client />;`,
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
    [
      "a browser-dependent JSX branch with an earlier dynamic operand",
      `"use client"; export const Page = ({ ready }) => <main>{ready && typeof window !== "undefined" && <ClientOnly />}</main>;`,
    ],
    [
      "a browser-dependent JSX branch with a nested condition group",
      `"use client"; export const Page = ({ ready }) => <main>{(ready && typeof document !== "undefined") && <ClientOnly />}</main>;`,
    ],
    [
      "a browser-dependent JSX branch with a truthy const alias",
      `"use client"; export const Page = () => { const enabled = true; return <main>{typeof window !== "undefined" && enabled && <ClientOnly />}</main>; };`,
    ],
    [
      "a hydration branch behind state with a lazy true initializer",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(() => true); return mounted && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind state with an unknown initializer",
      `import { useState } from "react"; export const Page = ({ initialMounted }) => { const [mounted] = useState(initialMounted); return mounted && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind state with a mutated initializer alias",
      `import { useState } from "react"; export const Page = () => { let initialMounted = false; initialMounted = true; const [mounted] = useState(initialMounted); return mounted && (typeof document === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind an initially false OR operand",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); return mounted || (typeof window === "undefined" ? <Server /> : <Client />); };`,
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
      "a mounted state guard",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); return <div>{mounted && (typeof window === "undefined" ? <Server /> : <Client />)}</div>; };`,
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
      "a const alias of mounted state",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); const ready = mounted; return ready && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind an initially true OR gate",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); return !mounted || (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind a nested initially true OR gate",
      `import { useState } from "react"; export const Page = ({ ready }) => { const [mounted] = useState(false); return !mounted || (ready && (typeof document === "undefined" ? <Server /> : <Client />)); };`,
    ],
    [
      "a hydration branch behind lazy false state",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(() => false); return mounted && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind unary-negated false state",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(!true); return mounted && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a hydration branch behind an immutable false initializer alias",
      `import { useState } from "react"; export const Page = () => { const initialMounted = false; const [mounted] = useState(initialMounted); return mounted && (typeof window === "undefined" ? <Server /> : <Client />); };`,
    ],
    [
      "a browser probe inside an OR condition that is already true",
      `"use client"; export const Page = () => { const ready = true; return <main>{(typeof window !== "undefined" || ready) && <ClientOnly />}</main>; };`,
    ],
    [
      "an if statement whose AND operand is always false",
      `"use client"; export const Page = () => { const enabled = false; if (typeof window !== "undefined" && enabled) return <Client />; return <Server />; };`,
    ],
    [
      "an if statement whose OR operand is always true",
      `"use client"; export const Page = () => { const enabled = true; if (enabled || typeof document === "undefined") return <Server />; return <Client />; };`,
    ],
    [
      "a ternary whose AND operand is always false",
      `"use client"; export const Page = () => false && typeof document === "undefined" ? <Server /> : <Client />;`,
    ],
    [
      "a ternary whose OR operand is always true",
      `"use client"; export const Page = () => typeof window !== "undefined" || true ? <Client /> : <Server />;`,
    ],
    [
      "an if statement with contradictory browser predicates",
      `"use client"; export const Page = () => { if (typeof window !== "undefined" && !(typeof window !== "undefined")) return <Client />; return <Server />; };`,
    ],
    [
      "a ternary with exhaustive browser predicates",
      `"use client"; export const Page = () => typeof document === "undefined" || !(typeof document === "undefined") ? <Server /> : <Client />;`,
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
    [
      "a logical JSX branch blocked after the browser predicate",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && false && <ClientOnly />}</main>;`,
    ],
    [
      "a logical JSX branch blocked before the browser predicate",
      `"use client"; export const Page = () => <main>{false && typeof window !== "undefined" && <ClientOnly />}</main>;`,
    ],
    [
      "a logical JSX branch blocked by a later const alias",
      `"use client"; export const Page = () => { const enabled = false; return <main>{typeof window !== "undefined" && enabled && <ClientOnly />}</main>; };`,
    ],
    [
      "a logical JSX branch blocked by an earlier const alias",
      `"use client"; export const Page = () => { const enabled = false; return <main>{enabled && typeof document !== "undefined" && <ClientOnly />}</main>; };`,
    ],
    [
      "a logical JSX branch blocked inside a nested rendered group",
      `"use client"; export const Page = () => <main>{typeof window !== "undefined" && (false && <ClientOnly />)}</main>;`,
    ],
    [
      "a logical JSX branch blocked inside a nested condition group",
      `"use client"; export const Page = () => <main>{(typeof document !== "undefined" && false) && <ClientOnly />}</main>;`,
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

  it("reports structural differences below suppressHydrationWarning", () => {
    const result = run(
      `"use client"; export const Page = () => <main suppressHydrationWarning>{typeof window === "undefined" ? <span>server</span> : <div>client</div>}</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports structural differences when a branch has suppressHydrationWarning", () => {
    const result = run(
      `"use client"; export const Page = () => typeof window === "undefined" ? <span suppressHydrationWarning>server</span> : <div>client</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
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
