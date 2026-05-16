/**
 * Regression tests for `tanstack-start-get-mutation`.
 *
 * The rule shares `findSideEffect` with `nextjs-no-side-effect-in-get-handler`
 * but receives the handler function NODE (the `.handler(() => {...})`
 * callback) rather than its body. `collectLocallyScoped*Bindings` use
 * `walkInsideStatementBlocks`, which stops at function boundaries — so
 * previously every aliased safe / cookie pattern inside a TanStack Start
 * handler slipped past the per-binding precision and either:
 *   - leaked a false-positive (`const customHeaders = new Headers(); customHeaders.set(...)`),
 *   - or got the wrong diagnostic message (`cs.set()` instead of `cookies().set()`).
 *
 * These cases pin down the unwrap fix.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import { buildTestProject, setupReactProject, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-tanstack-get-mutation-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const RULE_NAME = "tanstack-start-get-mutation";

// HACK: `tanstackStartGetMutation` matches any `<chain>.handler(fn)` call
// whose chain is rooted in `createServerFn` (see `walkServerFnChain`).
// The fixture stubs `createServerFn` so we don't need the real package
// installed; the AST shape is what the rule walks.
const CREATE_SERVER_FN_STUB = `const chainable: any = new Proxy(
  {},
  { get: (_target, _prop) => (..._args: any[]) => chainable },
);
const createServerFn = (_options?: any) => chainable;
`;

const buildTanstackProject = (caseId: string): { rootDirectory: string; project: ProjectInfo } => {
  const rootDirectory = setupReactProject(tempRoot, caseId);
  return {
    rootDirectory,
    project: buildTestProject({ rootDirectory, framework: "tanstack-start" }),
  };
};

const writeRouteAndLint = async (
  caseId: string,
  filePath: string,
  source: string,
): Promise<Diagnostic[]> => {
  const { rootDirectory, project } = buildTanstackProject(caseId);
  writeFile(path.join(rootDirectory, filePath), `${CREATE_SERVER_FN_STUB}\n${source}`);
  return runOxlint({ rootDirectory, project });
};

const filterRule = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === RULE_NAME);

describe("tanstack-start-get-mutation: handler-body binding precision", () => {
  it("does NOT flag `const customHeaders = new Headers(); customHeaders.set(...)` inside .handler()", async () => {
    const diagnostics = await writeRouteAndLint(
      "tanstack-aliased-headers",
      "src/routes/headers-fn.tsx",
      `export const headersFn = createServerFn().handler(async () => {
  const customHeaders = new Headers();
  customHeaders.set("x-trace", "abc");
  customHeaders.append("x-source", "test");
  return { ok: true };
});
`,
    );
    expect(filterRule(diagnostics)).toHaveLength(0);
  });

  it("does NOT flag `const cache = new Map(); cache.set(...)` inside .handler()", async () => {
    const diagnostics = await writeRouteAndLint(
      "tanstack-aliased-map",
      "src/routes/map-fn.tsx",
      `export const mapFn = createServerFn().handler(async () => {
  const cache = new Map<string, number>();
  cache.set("hit", Date.now());
  return { ok: true };
});
`,
    );
    expect(filterRule(diagnostics)).toHaveLength(0);
  });

  it("flags aliased cookies (`const cs = cookies(); cs.set('x','y')`) as `cookies().set()`, not `cs.set()`", async () => {
    const diagnostics = await writeRouteAndLint(
      "tanstack-aliased-cookies",
      "src/routes/cookies-fn.tsx",
      `declare const cookies: () => { set: (a: string, b: string) => void; delete: (a: string) => void };

export const cookiesFn = createServerFn().handler(async () => {
  const cs = cookies();
  cs.set("flag", "1");
  return { ok: true };
});
`,
    );
    const hits = filterRule(diagnostics);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("cookies().set()");
  });

  it("still flags real mutations on non-safe receivers inside .handler() (regression control)", async () => {
    const diagnostics = await writeRouteAndLint(
      "tanstack-real-mutation",
      "src/routes/delete-fn.tsx",
      `declare const db: { users: { delete: (id: string) => Promise<void> } };

export const deleteFn = createServerFn().handler(async () => {
  await db.users.delete("123");
  return { ok: true };
});
`,
    );
    const hits = filterRule(diagnostics);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".delete()");
  });
});
