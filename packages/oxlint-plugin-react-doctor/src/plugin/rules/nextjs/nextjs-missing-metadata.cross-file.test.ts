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

describe("nextjs-missing-metadata — cross-file", () => {
  it("flags a page with no metadata and no ancestor layout metadata", () => {
    writeFile(
      "src/app/layout.tsx",
      `
        export default function RootLayout({ children }: { children: React.ReactNode }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile(
      "src/app/page.tsx",
      `
        export default function Page() {
          return <main>Hello</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a page covered by a root layout `metadata` export", () => {
    writeFile(
      "src/app/layout.tsx",
      `
        import type { Metadata } from "next";
        export const metadata: Metadata = {
          title: { default: "My Site", template: "%s | My Site" },
          description: "A site",
        };
        export default function RootLayout({ children }: { children: React.ReactNode }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile(
      "src/app/page.tsx",
      `
        export default function Page() {
          return <main>Hello</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nested page covered by an ancestor layout `generateMetadata` export", () => {
    writeFile(
      "src/app/blog/layout.tsx",
      `
        export async function generateMetadata() {
          return { title: "Blog" };
        }
        export default function BlogLayout({ children }: { children: React.ReactNode }) {
          return <section>{children}</section>;
        }
      `,
    );
    const pagePath = writeFile(
      "src/app/blog/[slug]/page.tsx",
      `
        export default function PostPage() {
          return <article>Post</article>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the layout re-exports metadata via a specifier", () => {
    writeFile(
      "src/app/layout.tsx",
      `
        import { sharedMetadata as metadata } from "../seo";
        export { metadata };
        export default function RootLayout({ children }: { children: React.ReactNode }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile(
      "src/app/page.tsx",
      `
        export default function Page() {
          return <main>Hello</main>;
        }
      `,
    );

    const result = runRule(nextjsMissingMetadata, fs.readFileSync(pagePath, "utf8"), {
      filename: pagePath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a nested page when only a sibling route group has layout metadata", () => {
    writeFile(
      "src/app/(marketing)/layout.tsx",
      `
        export const metadata = { title: "Marketing" };
        export default function MarketingLayout({ children }: { children: React.ReactNode }) {
          return <div>{children}</div>;
        }
      `,
    );
    writeFile(
      "src/app/layout.tsx",
      `
        export default function RootLayout({ children }: { children: React.ReactNode }) {
          return <html><body>{children}</body></html>;
        }
      `,
    );
    const pagePath = writeFile(
      "src/app/blog/page.tsx",
      `
        export default function BlogPage() {
          return <main>Blog</main>;
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
