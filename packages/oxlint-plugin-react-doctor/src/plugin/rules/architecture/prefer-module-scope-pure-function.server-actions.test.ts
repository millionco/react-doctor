import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopePureFunction } from "./prefer-module-scope-pure-function.js";

const projectRoot = "/project";
const nextServerActionSettings = {
  "react-doctor": {
    capabilities: ["nextjs", "server-actions", "react"],
    rootDirectory: projectRoot,
  },
};

const serverActionPage = `
  export default function Screen() {
    async function submitDraft() {
      "use server";
      return 1;
    }
    return <form action={submitDraft} />;
  }
`;

describe("prefer-module-scope-pure-function inline Server Actions", () => {
  it.each(["app/send/page.tsx", "src/app/(studio)/layout.tsx"])(
    "keeps a direct async Server Action declaration in %s",
    (relativeFilename) => {
      const result = runRule(preferModuleScopePureFunction, serverActionPage, {
        filename: `${projectRoot}/${relativeFilename}`,
        settings: nextServerActionSettings,
      });

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    ["an ordinary async declaration", "async function submitDraft() { return 1; }"],
    ["a synchronous directive", 'function submitDraft() { "use server"; return 1; }'],
    ["an async generator", 'async function* submitDraft() { "use server"; yield 1; }'],
    [
      "a string after executable code",
      'async function submitDraft() { const count = 1; "use server"; return count; }',
    ],
    ["a parenthesized string", 'async function submitDraft() { ("use server"); return 1; }'],
    ["an arrow outside the supported shape", 'const submitDraft = async () => { "use server"; };'],
    [
      "a declaration in a nested block",
      '{ async function submitDraft() { "use server"; return 1; } }',
    ],
  ])("still reports %s", (_description, declaration) => {
    const result = runRule(
      preferModuleScopePureFunction,
      `export default function Screen() { ${declaration} return <div />; }`,
      { filename: `${projectRoot}/app/send/page.tsx`, settings: nextServerActionSettings },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("submitDraft");
  });

  it("recognizes an escaped action directive in the function prologue", () => {
    const result = runRule(
      preferModuleScopePureFunction,
      serverActionPage.replace('"use server"', String.raw`"use\u0020server"`),
      {
        filename: `${projectRoot}/app/send/page.tsx`,
        settings: nextServerActionSettings,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    '"use client";',
    String.raw`"use\u0020client";`,
    '"use server";',
    String.raw`"use\u0020server";`,
  ])("still reports an inline directive in a module with %s", (directive) => {
    const result = runRule(
      preferModuleScopePureFunction,
      `${directive}${serverActionPage.replace("export default function", "export default async function")}`,
      {
        filename: `${projectRoot}/app/send/page.tsx`,
        settings: nextServerActionSettings,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "/project/pages/send/page.tsx",
    "/project/app/send/helpers.tsx",
    "/project/app/(studio)/_private/page.tsx",
    "/other/app/page.tsx",
  ])("still reports outside a recognized App Router entry at %s", (filename) => {
    const result = runRule(preferModuleScopePureFunction, serverActionPage, {
      filename,
      settings: nextServerActionSettings,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["mts", "mjs"])("still reports a route using nondefault extension %s", (extension) => {
    const result = runRule(
      preferModuleScopePureFunction,
      serverActionPage.replace("return <form action={submitDraft} />;", "return null;"),
      {
        filename: `${projectRoot}/app/send/page.${extension}`,
        settings: nextServerActionSettings,
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([[], ["nextjs"], ["remix", "server-actions"]].map((capabilities) => ({ capabilities })))(
    "still reports without both Next.js and Server Actions capabilities ($capabilities)",
    ({ capabilities }) => {
      const result = runRule(preferModuleScopePureFunction, serverActionPage, {
        filename: `${projectRoot}/app/send/page.tsx`,
        settings: { "react-doctor": { rootDirectory: projectRoot, capabilities } },
      });

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
