import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../test-utils/parse-fixture.js";
import plugin from "./react-doctor-plugin.js";
import { ruleRegistry } from "./rule-registry.js";
import { RULE_REQUIRED_IMPORTS } from "./rule-required-imports.js";
import type { BaseRuleContext } from "./utils/rule-context.js";

const INK_RULE_ID = "ink-no-measure-element-in-render";
const JOTAI_RULE_ID = "jotai-derived-atom-returns-fresh-object";
const MOTION_RULE_ID = "motion-value-constructor-in-render";
const UNGATED_INK_RULE_ID = "ink-no-raw-text";

interface HostContextOptions {
  readonly filename?: string;
  readonly withText?: boolean;
}

let inkPackageDirectory = "";

beforeAll(() => {
  inkPackageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-required-imports-"));
  fs.writeFileSync(
    path.join(inkPackageDirectory, "package.json"),
    JSON.stringify({ name: "ink-app", dependencies: { ink: "6.0.0" } }),
  );
});

afterAll(() => {
  fs.rmSync(inkPackageDirectory, { recursive: true, force: true });
});

const createHostContext = (code: string, options: HostContextOptions = {}): BaseRuleContext => {
  const filename = options.filename ?? "/project/src/fixture.tsx";
  const parsed = parseFixture(code, { filename: path.basename(filename) });
  return {
    report: () => {},
    filename,
    sourceCode: {
      ast: parsed.program,
      ...(options.withText === false ? {} : { getText: () => code }),
    },
  };
};

const visitorCount = (ruleId: string, code: string, options?: HostContextOptions): number =>
  Object.keys(plugin.rules[ruleId].create(createHostContext(code, options))).length;

const inkVisitorCount = (ruleId: string, code: string): number =>
  visitorCount(ruleId, code, { filename: path.join(inkPackageDirectory, "src", "app.tsx") });

describe("RULE_REQUIRED_IMPORTS", () => {
  it("only lists registered rule ids", () => {
    for (const ruleId of Object.keys(RULE_REQUIRED_IMPORTS)) {
      expect(ruleRegistry[ruleId], ruleId).toBeDefined();
    }
  });

  it("never lists rules that can report without a library import", () => {
    expect(RULE_REQUIRED_IMPORTS[UNGATED_INK_RULE_ID]).toBeUndefined();
    expect(RULE_REQUIRED_IMPORTS["no-layout-property-animation"]).toBeUndefined();
    expect(RULE_REQUIRED_IMPORTS["jotai-tq-use-raw-query-atom"]).toBeUndefined();
    expect(RULE_REQUIRED_IMPORTS["webgl-no-sync-readback-in-animation-loop"]).toBeUndefined();
    expect(RULE_REQUIRED_IMPORTS["window-open-without-noopener"]).toBeUndefined();
  });
});

describe("required-imports gate", () => {
  it("returns no visitors for a file that never imports the library", () => {
    expect(inkVisitorCount(INK_RULE_ID, `import React from "react";\nexport const a = 1;`)).toBe(0);
    expect(visitorCount(JOTAI_RULE_ID, `import { create } from "zustand";`)).toBe(0);
    expect(visitorCount(MOTION_RULE_ID, `import { motion } from "./motion";`)).toBe(0);
  });

  it("runs the rule when the library is imported statically", () => {
    expect(
      inkVisitorCount(INK_RULE_ID, `import { measureElement } from "ink";\nexport const a = 1;`),
    ).toBeGreaterThan(0);
    expect(visitorCount(JOTAI_RULE_ID, `import { atom } from "jotai";`)).toBeGreaterThan(0);
    expect(visitorCount(MOTION_RULE_ID, `import { motion } from "motion/react";`)).toBeGreaterThan(
      0,
    );
  });

  it("treats package subpaths, re-exports, require() and dynamic import() as imports", () => {
    expect(
      visitorCount(JOTAI_RULE_ID, `import { selectAtom } from "jotai/utils";`),
    ).toBeGreaterThan(0);
    expect(visitorCount(JOTAI_RULE_ID, `export { atom } from "jotai";`)).toBeGreaterThan(0);
    expect(visitorCount(JOTAI_RULE_ID, `export * from "jotai";`)).toBeGreaterThan(0);
    expect(
      visitorCount(JOTAI_RULE_ID, `const run = () => { const { atom } = require("jotai"); };`),
    ).toBeGreaterThan(0);
    expect(
      visitorCount(JOTAI_RULE_ID, `const load = async () => { await import("jotai"); };`),
    ).toBeGreaterThan(0);
  });

  it("finds nested require() without host source text", () => {
    expect(
      visitorCount(JOTAI_RULE_ID, `const run = () => { const { atom } = require("jotai"); };`, {
        withText: false,
      }),
    ).toBeGreaterThan(0);
    expect(visitorCount(JOTAI_RULE_ID, `export const a = 1;`, { withText: false })).toBe(0);
  });

  it("does not match unrelated packages sharing a prefix", () => {
    expect(visitorCount(JOTAI_RULE_ID, `import { x } from "jotai-tanstack-query";`)).toBe(0);
    expect(inkVisitorCount(INK_RULE_ID, `import { x } from "inkjs";`)).toBe(0);
  });

  it("leaves ungated rules untouched", () => {
    expect(inkVisitorCount(UNGATED_INK_RULE_ID, `export const a = 1;`)).toBeGreaterThan(0);
  });

  it("runs gated rules when the host exposes no AST", () => {
    const visitors = plugin.rules[JOTAI_RULE_ID].create({
      report: () => {},
      filename: "/project/src/fixture.tsx",
    });
    expect(Object.keys(visitors).length).toBeGreaterThan(0);
  });
});
