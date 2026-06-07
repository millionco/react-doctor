import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { nextjsNoUseSearchParamsWithoutSuspense } from "./nextjs-no-use-search-params-without-suspense.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "use-search-params-xfile-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

describe("nextjs-no-use-search-params-without-suspense — cross-file", () => {
  it("flags when a page renders an imported component that calls useSearchParams without Suspense", () => {
    writeFile(
      "search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import { SearchBar } from "./search-bar";
        export default function Page() {
          return <div><SearchBar /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      { filename: pagePath },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("SearchBar");
  });

  it("does not flag when the imported component is wrapped in Suspense", () => {
    writeFile(
      "search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import { Suspense } from "react";
        import { SearchBar } from "./search-bar";
        export default function Page() {
          return <Suspense fallback={<div>loading</div>}><SearchBar /></Suspense>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      { filename: pagePath },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the imported component does not use useSearchParams", () => {
    writeFile(
      "header.tsx",
      `
        export const Header = () => <h1>Hello</h1>;
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import { Header } from "./header";
        export default function Page() {
          return <div><Header /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      { filename: pagePath },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-page files even if they render a component using useSearchParams", () => {
    writeFile(
      "search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const componentPath = writeFile(
      "navbar.tsx",
      `
        import { SearchBar } from "./search-bar";
        export const Navbar = () => <nav><SearchBar /></nav>;
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(componentPath, "utf8"),
      { filename: componentPath },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a default-exported component that calls useSearchParams", () => {
    writeFile(
      "search-widget.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        const SearchWidget = () => {
          const params = useSearchParams();
          return <div>{params.toString()}</div>;
        };
        export default SearchWidget;
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import SearchWidget from "./search-widget";
        export default function Page() {
          return <div><SearchWidget /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      { filename: pagePath },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("SearchWidget");
  });

  it("does not flag a memo component for an unrelated sibling export's useSearchParams", () => {
    writeFile(
      "widgets.tsx",
      `
        "use client";
        import { memo } from "react";
        import { useSearchParams } from "next/navigation";
        export const Header = memo(() => <h1>Title</h1>);
        export const SearchThing = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import { Header } from "./widgets";
        export default function Page() {
          return <div><Header /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the consumer is wrapped in <React.Suspense>", () => {
    writeFile(
      "search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import * as React from "react";
        import { SearchBar } from "./search-bar";
        export default function Page() {
          return <React.Suspense fallback={<div>loading</div>}><SearchBar /></React.Suspense>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the consumer is wrapped in an aliased Suspense import", () => {
    writeFile(
      "search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "page.tsx",
      `
        import { Suspense as Boundary } from "react";
        import { SearchBar } from "./search-bar";
        export default function Page() {
          return <Boundary fallback={<div>loading</div>}><SearchBar /></Boundary>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a consumer imported via a tsconfig `@/` path alias", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    writeFile(
      "src/components/search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "src/app/page.tsx",
      `
        import { SearchBar } from "@/components/search-bar";
        export default function Page() {
          return <div><SearchBar /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("SearchBar");
  });

  it("flags a consumer imported through a barrel index re-export", () => {
    writeFile(
      "components/search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    writeFile("components/index.ts", `export { SearchBar } from "./search-bar";`);
    const pagePath = writeFile(
      "page.tsx",
      `
        import { SearchBar } from "./components";
        export default function Page() {
          return <div><SearchBar /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("SearchBar");
  });

  it("does not flag a direct call when an ancestor layout wraps children in <Suspense>", () => {
    writeFile(
      "app/dashboard/layout.tsx",
      `
        import { Suspense } from "react";
        export default function Layout({ children }) {
          return <Suspense fallback={<div>loading</div>}>{children}</Suspense>;
        }
      `,
    );
    const pagePath = writeFile(
      "app/dashboard/page.tsx",
      `
        import { useSearchParams } from "next/navigation";
        export default function Page() {
          const params = useSearchParams();
          return <div>{params.toString()}</div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a rendered consumer when an ancestor layout provides <Suspense>", () => {
    writeFile(
      "app/feed/layout.tsx",
      `
        import { Suspense } from "react";
        export default function Layout({ children }) {
          return <Suspense fallback={<div>loading</div>}>{children}</Suspense>;
        }
      `,
    );
    writeFile(
      "app/feed/search-bar.tsx",
      `
        "use client";
        import { useSearchParams } from "next/navigation";
        export const SearchBar = () => {
          const params = useSearchParams();
          return <input value={params.get("q") ?? ""} />;
        };
      `,
    );
    const pagePath = writeFile(
      "app/feed/page.tsx",
      `
        import { SearchBar } from "./search-bar";
        export default function Page() {
          return <div><SearchBar /></div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes an ancestor layout that wraps children in <React.Suspense>", () => {
    writeFile(
      "app/ns/layout.tsx",
      `
        import * as React from "react";
        export default function Layout({ children }) {
          return <React.Suspense fallback={<div>loading</div>}>{children}</React.Suspense>;
        }
      `,
    );
    const pagePath = writeFile(
      "app/ns/page.tsx",
      `
        import { useSearchParams } from "next/navigation";
        export default function Page() {
          const params = useSearchParams();
          return <div>{params.toString()}</div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a direct call when the ancestor layout has no <Suspense>", () => {
    writeFile(
      "app/plain/layout.tsx",
      `
        export default function Layout({ children }) {
          return <main>{children}</main>;
        }
      `,
    );
    const pagePath = writeFile(
      "app/plain/page.tsx",
      `
        import { useSearchParams } from "next/navigation";
        export default function Page() {
          const params = useSearchParams();
          return <div>{params.toString()}</div>;
        }
      `,
    );

    const result = runRule(
      nextjsNoUseSearchParamsWithoutSuspense,
      fs.readFileSync(pagePath, "utf8"),
      {
        filename: pagePath,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
