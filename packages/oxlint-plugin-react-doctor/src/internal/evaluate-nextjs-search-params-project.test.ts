import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";

const PROJECT_FILES = new Map<string, string>([
  [
    "src/search/index.ts",
    `export { SearchPanel } from "./search-panel";
export { Header } from "./widgets";`,
  ],
  [
    "src/search/search-panel.tsx",
    `export const SearchPanel = () => {
  const searchParameters = useSearchParams();
  return <output>{searchParameters.toString()}</output>;
};`,
  ],
  [
    "src/search/widgets.tsx",
    `export const Header = () => <h1>Search</h1>;
export const HiddenSearchPanel = () => {
  const searchParameters = useSearchParams();
  return <output>{searchParameters.toString()}</output>;
};`,
  ],
  [
    "app/direct/page.tsx",
    `"use client";\r
import { useSearchParams } from "next/navigation";\r
\r
export default function DirectPage() {\r
  "🔎";\r
  const searchParameters = useSearchParams();\r
  return <output>{searchParameters.toString()}</output>;\r
}`,
  ],
  [
    "app/imported/page.tsx",
    `import { SearchPanel } from "../../src/search";

export default function ImportedPage() {
  return <SearchPanel />;
}`,
  ],
  [
    "app/covered/layout.tsx",
    `import { Suspense } from "react";

export default function CoveredLayout({ children }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}`,
  ],
  [
    "app/covered/page.tsx",
    `import { useSearchParams } from "next/navigation";

export default function CoveredPage() {
  const searchParameters = useSearchParams();
  return <output>{searchParameters.toString()}</output>;
}`,
  ],
  [
    "app/bounded/page.tsx",
    `import { Suspense } from "react";
import { SearchPanel } from "../../src/search";

export default function BoundedPage() {
  return <Suspense fallback={null}><SearchPanel /></Suspense>;
}`,
  ],
  [
    "app/unrelated/page.tsx",
    `import { Header } from "../../src/search";

export default function UnrelatedPage() {
  return <Header />;
}`,
  ],
  [
    "app/missing/page.tsx",
    `import { MissingPanel } from "./missing-panel";

export default function MissingPage() {
  return <MissingPanel />;
}`,
  ],
  ["app/invalid/page.tsx", "export default const ="],
]);

const temporaryDirectories: string[] = [];

describe("nextjs search params project evaluation", () => {
  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps ancestor, barrel, and negative resolution behavior exactly aligned", () => {
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-search-params-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    for (const [filename, sourceText] of PROJECT_FILES) {
      const absoluteFilename = path.join(temporaryRootDirectory, filename);
      fs.mkdirSync(path.dirname(absoluteFilename), { recursive: true });
      fs.writeFileSync(absoluteFilename, sourceText, "utf8");
    }

    const realResult = evaluateProject({
      files: PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: ["nextjs-no-use-search-params-without-suspense"],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-search-params-project",
      files: PROJECT_FILES,
      ruleIds: ["nextjs-no-use-search-params-without-suspense"],
    });

    expect(virtualResult).toEqual(realResult);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, rule, message, line, column, offset, length, endLine, endColumn }) => ({
          filePath,
          rule,
          message,
          line,
          column,
          offset,
          length,
          endLine,
          endColumn,
        }),
      ),
    ).toEqual([
      {
        filePath: "app/direct/page.tsx",
        rule: "nextjs-no-use-search-params-without-suspense",
        message:
          "useSearchParams() without a <Suspense> boundary forces the whole page into client-side rendering.",
        line: 6,
        column: 28,
        offset: 147,
        length: 17,
        endLine: 6,
        endColumn: 45,
      },
      {
        filePath: "app/imported/page.tsx",
        rule: "nextjs-no-use-search-params-without-suspense",
        message:
          "<SearchPanel> uses useSearchParams() outside <Suspense>, so this page falls back to client-side rendering.",
        line: 4,
        column: 10,
        offset: 99,
        length: 15,
        endLine: 4,
        endColumn: 25,
      },
    ]);
    expect(virtualResult.failures).toEqual([
      {
        kind: "parse",
        filePath: "app/invalid/page.tsx",
        message: "Unexpected token",
        line: 1,
        column: 16,
        offset: 15,
        length: 5,
      },
    ]);
    expect(
      virtualResult.diagnostics.filter((diagnostic) =>
        [
          "app/covered/page.tsx",
          "app/bounded/page.tsx",
          "app/unrelated/page.tsx",
          "app/missing/page.tsx",
        ].includes(diagnostic.filePath),
      ),
    ).toEqual([]);
  });

  it("keeps source-only evaluation explicitly unsupported", () => {
    expect(
      evaluateSource({
        sourceText: `const searchParameters = useSearchParams();`,
        filename: "app/page.tsx",
        ruleIds: ["nextjs-no-use-search-params-without-suspense"],
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "unsupported-rule",
          filePath: "app/page.tsx",
          rule: "nextjs-no-use-search-params-without-suspense",
          message: "Rule requires a project host: nextjs-no-use-search-params-without-suspense",
        },
      ],
    });
  });
});
