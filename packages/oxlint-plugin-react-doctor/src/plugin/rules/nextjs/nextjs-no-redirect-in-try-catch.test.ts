import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoRedirectInTryCatch } from "./nextjs-no-redirect-in-try-catch.js";

const CASES: ReadonlyArray<{ name: string; code: string; expectedDiagnosticCount: number }> = [
  {
    name: "flags redirect() in a try body that has a catch handler",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try { redirect("/x"); } catch (e) {} };`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "ignores redirect() in the catch handler",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try {} catch { redirect("/x"); } };`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "ignores redirect() in the finally block",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try {} finally { redirect("/x"); } };`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "ignores redirect() in a try with only a finally (no catch)",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try { redirect("/x"); } finally {} };`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "flags at the inner try when the nested try is the one that catches",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try { try { redirect("/x"); } catch {} } catch {} };`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "flags an inner-catch redirect that the outer try body swallows",
    code: `import { redirect } from "next/navigation";
      export const action = () => { try { try {} catch { redirect("/x"); } } catch {} };`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "ignores redirect() outside any try",
    code: `import { redirect } from "next/navigation";
      export const action = () => { redirect("/x"); };`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "still flags redirect() nested in an if inside the try body",
    code: `import { redirect } from "next/navigation";
      export const action = (x) => { try { if (x) redirect("/x"); } catch (e) {} };`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "flags notFound() in a try body that has a catch handler",
    code: `import { notFound } from "next/navigation";
      export const action = () => { try { notFound(); } catch (e) {} };`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "flags permanentRedirect() in a try body that has a catch handler",
    code: `import { permanentRedirect } from "next/navigation";
      export const action = () => { try { permanentRedirect("/x"); } catch (e) {} };`,
    expectedDiagnosticCount: 1,
  },
];

describe("nextjs-no-redirect-in-try-catch", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const result = runRule(nextjsNoRedirectInTryCatch, testCase.code);
      expect(result.diagnostics).toHaveLength(testCase.expectedDiagnosticCount);
    });
  }
});
