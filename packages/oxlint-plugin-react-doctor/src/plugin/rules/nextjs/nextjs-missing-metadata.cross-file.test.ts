import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsMissingMetadata } from "./nextjs-missing-metadata.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "missing-metadata-xfile-"));
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

const PAGE_WITHOUT_METADATA = `
  export default function Page() {
    return <main>Home</main>;
  }
`;

describe("nextjs-missing-metadata — cross-file", () => {
  it("does not flag a page when a co-located layout exports metadata", () => {
    writeFile(
      "app/layout.tsx",
      `
        import type { Metadata } from "next";
        export const metadata: Metadata = { title: "Home", description: "Welcome" };
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nested page when an ancestor layout exports metadata", () => {
    writeFile(
      "app/layout.tsx",
      `
        export const metadata = { title: "Site" };
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/blog/[slug]/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a page when an ancestor layout exports generateMetadata", () => {
    writeFile(
      "app/layout.tsx",
      `
        export async function generateMetadata() {
          return { title: "Dynamic" };
        }
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the layout re-exports metadata via an export specifier", () => {
    writeFile(
      "app/layout.tsx",
      `
        const metadata = { title: "Site" };
        export { metadata };
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a page when the ancestor layout has no metadata export", () => {
    writeFile(
      "app/layout.tsx",
      `
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a page when no layout exists in the segment chain", () => {
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a page under a nested 'app' route segment that inherits root metadata", () => {
    writeFile(
      "app/layout.tsx",
      `
        export const metadata = { title: "Site" };
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a page when an ancestor layout.mts exports metadata", () => {
    writeFile(
      "app/layout.mts",
      `
        export const metadata = { title: "Site" };
        export default function RootLayout({ children }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile("app/page.tsx", PAGE_WITHOUT_METADATA);

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a page that exports metadata via an export specifier", () => {
    const pagePath = writeFile(
      "app/page.tsx",
      `
        const metadata = { title: "Home" };
        export { metadata };
        export default function Page() {
          return <main>Home</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a page that renames a local binding to the metadata export", () => {
    const pagePath = writeFile(
      "app/page.tsx",
      `
        const pageMeta = { title: "Home" };
        export { pageMeta as metadata };
        export default function Page() {
          return <main>Home</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a page that exports a non-metadata binding aliased from metadata", () => {
    const pagePath = writeFile(
      "app/page.tsx",
      `
        const metadata = { title: "Home" };
        export { metadata as somethingElse };
        export default function Page() {
          return <main>Home</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
