import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const findAlias = "const value = rows.find((row) => row.id === slug);";

describe("find-result aliases after canonical Next notFound exits", () => {
  it.each([
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound as missing } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (!value) { const reason = slug; missing(); } return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (value === undefined) notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (value) {} else notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} const other = rows.find((row) => row.id !== slug); if (!other || !value) notFound(); return value.title; }`,
  ])("accepts a proven imported exit: %s", (code) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `function notFound() {} function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound } from "other/navigation";
     function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug, notFound) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     notFound = () => {};
     function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import type { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (!value) { try { notFound(); } catch {} } return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug, disabled) { ${findAlias} if (!value) { if (disabled) notFound(); } return value.title; }`,
    `const notFound = (() => {}) as () => never;
     function render(rows, slug) { ${findAlias} if (!value) notFound(); return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug, disabled) { ${findAlias} if (!value) { try { notFound(); } catch (error) { if (disabled) throw error; } } return value.title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} const title = value.title; if (!value) notFound(); return title; }`,
    `import { notFound } from "next/navigation";
     function render(rows, slug) { ${findAlias} if (!value) schedule(() => notFound()); return value.title; }`,
  ])("does not trust an unproven exit: %s", (code) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe.each(["redirect", "permanentRedirect"])(
  "find-result aliases after canonical Next %s exits",
  (exitName) => {
    it.each([
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} as leave } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) { const reason = slug; leave("/missing"); } return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (value === undefined) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (value) {} else ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} const other = rows.find((row) => row.id !== slug); if (!other || !value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       export default async function Page({params}) { const {slug} = await params; const value = rows.find((row) => row.id === slug); if (!value) ${exitName}("/missing"); return <h1>{value.title}</h1>; }`,
    ])("accepts a closed canonical navigation exit: %s", (code) => {
      const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      `function ${exitName}() {} function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "other/navigation";
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug, ${exitName}) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       ${exitName} = () => {};
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import type { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) { try { ${exitName}("/missing"); } catch {} } return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug, disabled) { ${findAlias} if (!value) { if (disabled) ${exitName}("/missing"); } return value.title; }`,
      `const ${exitName} = (() => {}) as (path: string) => never;
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) ${exitName}?.("/missing"); return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug, disabled) { ${findAlias} if (!value) { try { ${exitName}("/missing"); } catch (error) { if (disabled) throw error; } } return value.title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} const title = value.title; if (!value) ${exitName}("/missing"); return title; }`,
      `import { ${exitName} } from "next/navigation";
       function render(rows, slug) { ${findAlias} if (!value) schedule(() => ${exitName}("/missing")); return value.title; }`,
    ])("keeps an unproven adjacent navigation call unsafe: %s", (code) => {
      const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  },
);
