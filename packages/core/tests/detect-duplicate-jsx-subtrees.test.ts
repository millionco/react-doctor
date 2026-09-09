import { describe, expect, it } from "vite-plus/test";
import {
  detectDuplicateJsxSubtrees,
  detectDuplicateJsxSubtreesCooperative,
} from "../src/react-cleanup/detect-duplicate-jsx-subtrees.js";

const componentSource = (componentName: string, title: string, variableName: string): string => `
export const ${componentName} = () => (
  <section className="card">
    <header><h2>${title}</h2></header>
    <main><Value value={${variableName}} /></main>
    <footer><Button /></footer>
  </section>
);
`;

describe("detectDuplicateJsxSubtrees", () => {
  it("counts small subtrees toward coverage and budgets even when grouping excludes them", () => {
    const sources = ["first.tsx", "second.tsx"].map((path) => ({
      path,
      sourceText: "export const Card = () => <><A /><B /></>;",
    }));
    expect(detectDuplicateJsxSubtrees(sources)).toMatchObject({
      families: [],
      scannedSourceFileCount: 2,
      scannedJsxNodeCount: 6,
      incomplete: false,
    });
    expect(detectDuplicateJsxSubtrees(sources, { budget: { maxJsxNodes: 5 } })).toMatchObject({
      families: [],
      scannedSourceFileCount: 1,
      scannedJsxNodeCount: 3,
      incompleteReasons: [{ kind: "jsx-node-limit", limit: 5, observed: 6, path: "second.tsx" }],
    });
  });

  it("preserves non-ordering minimum thresholds", () => {
    const result = detectDuplicateJsxSubtrees(
      ["first.tsx", "second.tsx"].map((path) => ({
        path,
        sourceText: "export const Card = () => <><A /><B /></>;",
      })),
      { minimumNodeCount: Number.NaN, minimumDepth: Number.NaN },
    );
    expect(result.families).toHaveLength(1);
    expect(result.families[0]).toMatchObject({ nodeCount: 3, depth: 2, occurrenceCount: 2 });
    expect(result.scannedJsxNodeCount).toBe(6);
  });

  it.each([
    {
      name: "Unicode and lone surrogates",
      className: "🙂\ud800:\udc00",
      fingerprint: "jsx:a4e073afef1245b6322eb07c90bd0bf3be96cdf7ae65f0663e5fd422ac2394b3",
    },
    {
      name: "a full hash buffer",
      className: "a".repeat(65_501),
      fingerprint: "jsx:f62053eb7de604cd5e86666418613899b1f56ae46e0971b060bcf60fd1b1e243",
    },
    {
      name: "hash buffer overflow",
      className: "a".repeat(65_502),
      fingerprint: "jsx:173d677b5aaa512f471cbf93f2029b9a580e5d7e89f207b6609519b5b31cdc20",
    },
    {
      name: "a large static attribute",
      className: "a".repeat(262_144),
      fingerprint: "jsx:9f11ef18d3b6d4807f676f2f46d206298998f646347676c89d82f1fd5d4756d5",
    },
  ])("preserves fingerprints with $name", async ({ className, fingerprint }) => {
    const sources = ["First", "Second"].map((componentName, index) => ({
      path: `src/${index}.tsx`,
      sourceText: componentSource(componentName, "Title", "item").replace(
        'className="card"',
        `className="${className}"`,
      ),
    }));
    const result = detectDuplicateJsxSubtrees(sources);
    const cooperativeResult = await detectDuplicateJsxSubtreesCooperative({
      paths: sources.map((source) => source.path),
      read: async (filePath) =>
        sources.find((source) => source.path === filePath)?.sourceText ?? null,
    });

    expect(result).toMatchObject({
      incomplete: false,
      incompleteReasons: [],
      scannedSourceFileCount: 2,
      scannedJsxNodeCount: 14,
    });
    expect(result.families).toHaveLength(1);
    expect(result.families[0]).toMatchObject({
      fingerprint,
      nodeCount: 7,
      depth: 3,
      occurrenceCount: 2,
    });
    expect(cooperativeResult).toEqual(result);
  });

  it.each([
    "export const label = 'ready';",
    "export const isEarlier = (left: number, right: number) => left < right;",
    "export const Fragment = () => <>text</>;",
  ])(
    "keeps complete coverage for a source without duplicate candidates: %s",
    async (sourceText) => {
      const sources = [{ path: "src/plain.tsx", sourceText }];
      const result = detectDuplicateJsxSubtrees(sources);
      const cooperativeResult = await detectDuplicateJsxSubtreesCooperative({
        paths: sources.map((source) => source.path),
        read: async () => sourceText,
      });

      expect(result).toMatchObject({
        families: [],
        scannedSourceFileCount: 1,
        incomplete: false,
        incompleteReasons: [],
      });
      expect(cooperativeResult).toEqual(result);
    },
  );

  it("preserves source-length limits when a file cannot contain JSX", () => {
    const sourceText = "export const label = 'ready';";
    const result = detectDuplicateJsxSubtrees([{ path: "src/plain.ts", sourceText }], {
      budget: { maxSourceLengthChars: 10 },
    });

    expect(result).toMatchObject({
      families: [],
      scannedSourceFileCount: 0,
      incomplete: true,
      incompleteReasons: [
        {
          kind: "source-length-limit",
          limit: 10,
          observed: sourceText.length,
          path: "src/plain.ts",
        },
      ],
    });
  });

  it("preserves cancellation during a no-JSX source read", async () => {
    const abortController = new AbortController();
    const result = await detectDuplicateJsxSubtreesCooperative(
      {
        paths: ["src/plain.ts"],
        read: async () => {
          abortController.abort();
          return "export const label = 'ready';";
        },
      },
      { signal: abortController.signal },
    );

    expect(result).toMatchObject({
      families: [],
      scannedSourceFileCount: 0,
      incomplete: true,
      incompleteReasons: [{ kind: "aborted", observed: 0 }],
    });
  });

  it("groups structurally equivalent JSX while normalizing data leaves", () => {
    const result = detectDuplicateJsxSubtrees([
      {
        path: "src/account-card.tsx",
        sourceText: componentSource("AccountCard", "Account", "account"),
      },
      { path: "src/user-card.tsx", sourceText: componentSource("UserCard", "User", "user") },
    ]);

    expect(result.incomplete).toBe(false);
    expect(result.families).toHaveLength(1);
    expect(result.families[0]).toMatchObject({
      nodeCount: 7,
      depth: 3,
      occurrenceCount: 2,
      distinctFileCount: 2,
      estimatedRemovableNodeCount: 7,
      estimatedRemovableLineCount: 5,
      primaryOccurrence: {
        path: "src/account-card.tsx",
        rootName: "section",
        compositionPath: ["AccountCard", "section"],
      },
      relatedOccurrences: [
        {
          path: "src/user-card.tsx",
          rootName: "section",
          compositionPath: ["UserCard", "section"],
        },
      ],
    });
  });

  it("ignores JSX owned by non-React runtimes", () => {
    const solidComponentSource = (componentName: string): string => `
      import { createSignal } from "solid-js";
      export const ${componentName} = () => (
        <section classList={{ active: true }}>
          <header><h2>Title</h2></header>
          <main><Value /></main>
          <footer><Button /></footer>
        </section>
      );
    `;
    const result = detectDuplicateJsxSubtrees([
      { path: "src/first.tsx", sourceText: solidComponentSource("First") },
      { path: "src/second.tsx", sourceText: solidComponentSource("Second") },
    ]);

    expect(result.families).toEqual([]);
  });

  it("lets an explicit React runtime override a non-React JSX marker", () => {
    const reactComponentSource = (componentName: string): string => `
      import React from "react";
      export const ${componentName} = () => (
        <section classList={{ active: true }}>
          <header><h2>Title</h2></header>
          <main><Value /></main>
          <footer><Button /></footer>
        </section>
      );
    `;
    const result = detectDuplicateJsxSubtrees([
      { path: "src/first.tsx", sourceText: reactComponentSource("First") },
      { path: "src/second.tsx", sourceText: reactComponentSource("Second") },
    ]);

    expect(result.families).toHaveLength(1);
  });

  it("reports a maximal duplicate shared by two components in one file", () => {
    const sourceText = [
      componentSource("AccountCard", "Account", "account"),
      componentSource("UserCard", "User", "user"),
    ].join("\n");
    const result = detectDuplicateJsxSubtrees([{ path: "src/cards.tsx", sourceText }]);

    expect(result.families).toHaveLength(1);
    expect(result.families[0].primaryOccurrence.rootName).toBe("section");
    expect(result.families[0].primaryOccurrence.compositionPath).toEqual([
      "AccountCard",
      "section",
    ]);
    expect(result.families[0].relatedOccurrences[0].compositionPath).toEqual([
      "UserCard",
      "section",
    ]);
    expect(result.families[0].nodeCount).toBe(7);
  });

  it.each([
    [
      "an anonymous default function",
      `export default function () {
  return <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>;
}`,
    ],
    [
      "an anonymous default arrow",
      `export default () => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
);`,
    ],
    [
      "a memo-wrapped anonymous default arrow",
      `export default memo(() => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
));`,
    ],
    [
      "an as-cast anonymous default arrow",
      `export default (() => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
)) as React.FC;`,
    ],
    [
      "a satisfies-wrapped anonymous default arrow",
      `export default (memo(() => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
)) satisfies React.FC);`,
    ],
    [
      "a non-null memo-wrapped anonymous default arrow",
      `export default memo((() => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
)) as React.FC)!;`,
    ],
    [
      "an instantiated generic default arrow",
      `export default ((<Props,>(_props: Props) => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
))<Props>);`,
    ],
  ])("counts %s as a same-file composition root", (_label, defaultComponentSource) => {
    const sourceText = `
const NamedCard = () => (
  <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
);
${defaultComponentSource}
`;
    const result = detectDuplicateJsxSubtrees([{ path: "src/cards.tsx", sourceText }]);

    expect(result.families).toHaveLength(1);
    const family = result.families[0];
    expect(family.relatedOccurrences[0].compositionPath).toEqual(["default export", "section"]);
    expect(
      new Set(
        [family.primaryOccurrence, ...family.relatedOccurrences].map(
          (occurrence) => occurrence.compositionRootStartOffset,
        ),
      ).size,
    ).toBe(2);
  });

  it("suppresses repeated sibling structures inside one component", () => {
    const sourceText = `
const Page = () => (
  <main>
    <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
    <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
  </main>
);
`;
    const result = detectDuplicateJsxSubtrees([{ path: "src/page.tsx", sourceText }]);

    expect(result.families).toEqual([]);
  });

  it("suppresses trivial repeated leaves", () => {
    const sourceText = `
const Toolbar = () => <div><Button /><Button /><Button /></div>;
`;
    const result = detectDuplicateJsxSubtrees([{ path: "src/toolbar.tsx", sourceText }]);

    expect(result.families).toEqual([]);
  });

  it("does not group trees with different component composition", () => {
    const result = detectDuplicateJsxSubtrees([
      { path: "src/first.tsx", sourceText: componentSource("First", "First", "value") },
      {
        path: "src/second.tsx",
        sourceText: componentSource("Second", "Second", "value").replace("<Button />", "<Link />"),
      },
    ]);

    expect(result.families).toEqual([]);
  });

  it("preserves member names in dynamic expressions", () => {
    const accountSource = componentSource("AccountCard", "Account", "account.balance");
    const userSource = componentSource("UserCard", "User", "user.avatar");
    const result = detectDuplicateJsxSubtrees([
      { path: "src/account.tsx", sourceText: accountSource },
      { path: "src/user.tsx", sourceText: userSource },
    ]);

    expect(result.families).toEqual([]);
  });

  it("normalizes expression root bindings while preserving the member path", () => {
    const result = detectDuplicateJsxSubtrees([
      {
        path: "src/account.tsx",
        sourceText: componentSource("AccountCard", "Account", "account.balance"),
      },
      {
        path: "src/user.tsx",
        sourceText: componentSource("UserCard", "User", "user.balance"),
      },
    ]);

    expect(result.families).toHaveLength(1);
  });

  it("preserves expression operators", () => {
    const plusSource = componentSource("AccountCard", "Account", "value + adjustment");
    const minusSource = componentSource("UserCard", "User", "value - adjustment");
    const result = detectDuplicateJsxSubtrees([
      { path: "src/plus.tsx", sourceText: plusSource },
      { path: "src/minus.tsx", sourceText: minusSource },
    ]);

    expect(result.families).toEqual([]);
  });

  it("preserves static semantic JSX attribute values", () => {
    const cardSource = componentSource("AccountCard", "Account", "account");
    const dialogSource = componentSource("UserCard", "User", "user").replace(
      'className="card"',
      'className="dialog"',
    );
    const result = detectDuplicateJsxSubtrees([
      { path: "src/card.tsx", sourceText: cardSource },
      { path: "src/dialog.tsx", sourceText: dialogSource },
    ]);

    expect(result.families).toEqual([]);
  });

  it("parses JSX in JavaScript source files", () => {
    const sourceText = componentSource("Card", "Card", "value");
    const result = detectDuplicateJsxSubtrees([
      { path: "src/first.js", sourceText },
      { path: "src/second.js", sourceText },
    ]);

    expect(result.families).toHaveLength(1);
  });

  it("ignores JSX formatting whitespace and comment-only expressions", () => {
    const compactSource =
      "export const Compact = () => <section><header><h2>Title</h2></header><main><Value value={value} /></main><footer><Button /></footer></section>;";
    const formattedSource = `
export const Formatted = () => (
  <section>
    {/* layout */}
    <header>
      <h2>Other title</h2>
    </header>
    <main><Value value={otherValue} /></main>
    <footer><Button /></footer>
  </section>
);
`;
    const result = detectDuplicateJsxSubtrees([
      { path: "src/compact.tsx", sourceText: compactSource },
      { path: "src/formatted.tsx", sourceText: formattedSource },
    ]);

    expect(result.families).toHaveLength(1);
    expect(result.families[0].primaryOccurrence.rootName).toBe("section");
  });

  it("reads source files cooperatively within the source budget", async () => {
    const readPaths: string[] = [];
    const sourceText = componentSource("Card", "Card", "value");
    const result = await detectDuplicateJsxSubtreesCooperative(
      {
        paths: ["src/b.tsx", "src/a.tsx"],
        read: async (sourcePath) => {
          readPaths.push(sourcePath);
          return sourceText;
        },
      },
      { budget: { maxSourceFiles: 1 } },
    );

    expect(readPaths).toEqual(["src/a.tsx"]);
    expect(result).toMatchObject({
      incomplete: true,
      scannedSourceFileCount: 1,
      incompleteReasons: [{ kind: "source-file-limit", limit: 1, observed: 2 }],
    });
  });

  it("does not silently complete when a cooperative source read fails", async () => {
    const readFailure = new Error("synthetic read failure");

    await expect(
      detectDuplicateJsxSubtreesCooperative({
        paths: ["src/card.tsx"],
        read: async () => Promise.reject(readFailure),
      }),
    ).rejects.toBe(readFailure);
  });

  it("passes the source length budget to cooperative readers", async () => {
    const maximumLengths: number[] = [];
    await detectDuplicateJsxSubtreesCooperative(
      {
        paths: ["src/card.tsx"],
        read: async (_sourcePath, maximumLengthChars) => {
          maximumLengths.push(maximumLengthChars);
          return null;
        },
      },
      { budget: { maxSourceLengthChars: 123 } },
    );

    expect(maximumLengths).toEqual([123]);
  });

  it("reports deterministic file, node, and family budget incompleteness", () => {
    const duplicateSource = componentSource("Card", "Card", "value");
    const fileLimited = detectDuplicateJsxSubtrees(
      [
        { path: "src/b.tsx", sourceText: duplicateSource },
        { path: "src/a.tsx", sourceText: duplicateSource },
      ],
      { budget: { maxSourceFiles: 1 } },
    );
    const nodeLimited = detectDuplicateJsxSubtrees(
      [{ path: "src/card.tsx", sourceText: duplicateSource }],
      { budget: { maxJsxNodes: 1 } },
    );
    const familyLimited = detectDuplicateJsxSubtrees(
      [
        { path: "src/a.tsx", sourceText: duplicateSource },
        { path: "src/b.tsx", sourceText: duplicateSource },
      ],
      { budget: { maxFamilies: 0 } },
    );

    expect(fileLimited).toMatchObject({
      incomplete: true,
      scannedSourceFileCount: 1,
      incompleteReasons: [{ kind: "source-file-limit", limit: 1, observed: 2 }],
    });
    expect(nodeLimited).toMatchObject({
      incomplete: true,
      scannedSourceFileCount: 0,
      scannedJsxNodeCount: 0,
      incompleteReasons: [{ kind: "jsx-node-limit", limit: 1, path: "src/card.tsx" }],
    });
    expect(familyLimited).toMatchObject({
      incomplete: false,
      families: [],
      incompleteReasons: [],
    });
  });

  it("applies the JSX node budget before hashing a deeply nested subtree", () => {
    const nestingDepth = 500;
    const sourceText = `export const Deep = () => (${"<div>".repeat(nestingDepth)}value${"</div>".repeat(nestingDepth)});`;
    const result = detectDuplicateJsxSubtrees([{ path: "src/deep.tsx", sourceText }], {
      budget: { maxJsxNodes: 1 },
    });

    expect(result).toMatchObject({
      families: [],
      scannedSourceFileCount: 0,
      scannedJsxNodeCount: 0,
      incomplete: true,
      incompleteReasons: [{ kind: "jsx-node-limit", limit: 1, observed: 2 }],
    });
  });

  it("ranks families by estimated removable nodes before individual tree size", () => {
    const repeatedFamily = (componentName: string): string => `
export const ${componentName} = () => (
  <aside><header><Title /></header><main><Body /></main><footer><Button /></footer></aside>
);
`;
    const largerFamily = (componentName: string): string => `
export const ${componentName} = () => (
  <section><header><Title /><Subtitle /></header><main><Body /><Details /></main><footer><Button /></footer></section>
);
`;
    const result = detectDuplicateJsxSubtrees(
      [
        { path: "src/repeated-a.tsx", sourceText: repeatedFamily("RepeatedA") },
        { path: "src/repeated-b.tsx", sourceText: repeatedFamily("RepeatedB") },
        { path: "src/repeated-c.tsx", sourceText: repeatedFamily("RepeatedC") },
        { path: "src/larger-a.tsx", sourceText: largerFamily("LargerA") },
        { path: "src/larger-b.tsx", sourceText: largerFamily("LargerB") },
      ],
      { budget: { maxFamilies: 1 } },
    );

    expect(result.families).toHaveLength(1);
    expect(result.families[0]).toMatchObject({
      occurrenceCount: 3,
      estimatedRemovableNodeCount: 14,
      primaryOccurrence: { rootName: "aside" },
    });
  });

  it("stops before scanning when cancelled", () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = detectDuplicateJsxSubtrees(
      [{ path: "src/card.tsx", sourceText: componentSource("Card", "Card", "value") }],
      { signal: abortController.signal },
    );

    expect(result).toMatchObject({
      families: [],
      scannedSourceFileCount: 0,
      incomplete: true,
      incompleteReasons: [{ kind: "aborted", observed: 0 }],
    });
  });
});
