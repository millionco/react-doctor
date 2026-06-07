import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { nextjsNoUseSearchParamsWithoutSuspense } from "./nextjs-no-use-search-params-without-suspense.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "use-search-params-xfile-"));
  __clearParseSourceFileCacheForTests();
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
});
