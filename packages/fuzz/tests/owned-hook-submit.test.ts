import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";
import { findProgramRoot } from "../../oxlint-plugin-react-doctor/src/plugin/utils/find-program-root.js";
import { getNodeStartIndex } from "../../oxlint-plugin-react-doctor/src/plugin/utils/get-node-start-index.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-async-event-handler-without-reentry-guard.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
} from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

interface OwnedHookReport {
  readonly filename: string | undefined;
  readonly node: EsTreeNode;
  readonly program: EsTreeNode;
}

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-owned-hook-"));
const unsafeDirectory = path.join(directory, "unsafe");
const guardedDirectory = path.join(directory, "guarded");
const ownerFilename = path.join(unsafeDirectory, "delivery.tsx");
const consumerFilename = path.join(unsafeDirectory, "editor.tsx");
const guardedFilename = path.join(guardedDirectory, "delivery.tsx");
const fixtureFiles = [
  "package.json",
  "tsconfig.json",
  "delivery.tsx",
  "validator.ts",
  "editor.tsx",
  "controls.tsx",
];
const source = fs.readFileSync(
  new URL("../fixtures/owned-hook-submit/delivery.tsx.txt", import.meta.url),
  "utf8",
);
const guarded = source
  .replace("import { useState }", "import { useState, useRef }")
  .replace("  const [form, setForm]", "  const pending = useRef(false);\n  const [form, setForm]")
  .replace(
    "    event.preventDefault();",
    "    event.preventDefault();\n    if (pending.current) return;\n    pending.current = true;",
  );
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);

beforeEach(() => {
  for (const projectDirectory of [unsafeDirectory, guardedDirectory]) {
    fs.mkdirSync(projectDirectory, { recursive: true });
    for (const basename of fixtureFiles) {
      fs.writeFileSync(
        path.join(projectDirectory, basename),
        fs.readFileSync(new URL(`../fixtures/owned-hook-submit/${basename}.txt`, import.meta.url)),
      );
    }
  }
  fs.writeFileSync(guardedFilename, guarded);
  resetFilesystemCaches();
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("owned Hook async handler project fuzzing", () => {
  it("reports the owner's Await once and keeps the publishing consumer quiet", () => {
    const captured: OwnedHookReport[] = [];
    const owner = runRule(
      {
        ...noAsyncEventHandlerWithoutReentryGuard,
        create: (context) => {
          const create = noAsyncEventHandlerWithoutReentryGuard.create;
          if (!create) throw new Error("Expected an AST rule");
          return create({
            ...context,
            report: (descriptor) => {
              captured.push({
                filename: context.filename,
                node: descriptor.node,
                program: context.scopes.rootScope.node,
              });
              context.report(descriptor);
            },
          });
        },
      },
      source,
      { filename: ownerFilename, includeLocations: true },
    );
    expect(owner.parseErrors).toEqual([]);
    expect(owner.diagnostics).toHaveLength(1);
    expect(captured).toHaveLength(1);
    const report = captured[0];
    expect(report.filename).toBe(ownerFilename);
    expect(findProgramRoot(report.node)).toBe(report.program);
    expect(report.node.type).toBe("AwaitExpression");
    const offset = getNodeStartIndex(report.node);
    expect(offset).toBe(source.indexOf("await fetch"));
    if (offset === null) throw new Error("Missing Await location");
    expect(owner.diagnostics[0].line).toBe(source.slice(0, offset).split("\n").length);
    const consumer = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      fs.readFileSync(consumerFilename, "utf8"),
      { filename: consumerFilename },
    );
    expect(consumer.parseErrors).toEqual([]);
    expect(consumer.diagnostics).toEqual([]);
  });

  it("keeps a leading pending ref guard quiet in the owner", () => {
    expect(guarded).not.toBe(source);
    expect(guarded).toContain("if (pending.current) return;");
    expect(guarded).toContain("pending.current = true;");
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, guarded, {
      filename: guardedFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("replays a pure validator whose input data changes before awaiting", () => {
    const regressionFilename = fs.realpathSync(
      new URL(
        "../corpus/regressions/no-async-event-handler-without-reentry-guard--validator-data-interlock/delivery.tsx",
        import.meta.url,
      ),
    );
    const regressionSource = fs.readFileSync(regressionFilename, "utf8");
    expect(regressionSource).toContain("values: { ...previous.values, ready: false }");
    const validator = fs.readFileSync(
      path.join(path.dirname(regressionFilename), "validator.ts"),
      "utf8",
    );
    expect(validator).toContain('if (!fields.ready) issues.readiness = "Busy";');
    const regression = runRule(noAsyncEventHandlerWithoutReentryGuard, regressionSource, {
      filename: regressionFilename,
    });
    expect(regression.parseErrors).toEqual([]);
    expect(regression.diagnostics).toEqual([]);
    const result = fuzzRuleWithStats(
      "no-async-event-handler-without-reentry-guard",
      noAsyncEventHandlerWithoutReentryGuard,
      {
        iterations: 0,
        corpus: [
          {
            relativePath: "validator-data-interlock-delivery.tsx",
            sourcePath: regressionFilename,
            code: regressionSource,
            ruleIds: ["no-async-event-handler-without-reentry-guard"],
            verdict: "pass",
          },
        ],
      },
    );
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBe(1);
    expect(result.stats.firedProgramCount).toBe(0);
    const inverse = regressionSource.replace(
      "setForm((previous) => ({ ...previous, values: { ...previous.values, ready: false } }));",
      "setForm((previous) => ({ ...previous, issues }));",
    );
    expect(inverse).not.toBe(regressionSource);
    for (const basename of fixtureFiles) {
      fs.copyFileSync(
        path.join(path.dirname(regressionFilename), basename),
        path.join(unsafeDirectory, basename),
      );
    }
    fs.writeFileSync(ownerFilename, inverse);
    resetFilesystemCaches();
    const inverseResult = runRule(noAsyncEventHandlerWithoutReentryGuard, inverse, {
      filename: ownerFilename,
    });
    expect(inverseResult.parseErrors).toEqual([]);
    expect(inverseResult.diagnostics).toHaveLength(1);
  });

  it(
    "fuzzes the physical owner with firing and guarded project seeds",
    () => {
      expect(Number.isInteger(iterations) && iterations > 0).toBe(true);
      expect(Number.isInteger(seed) && seed > 0).toBe(true);
      const physicalOwners = [ownerFilename, guardedFilename].map((filename) => ({
        filename,
        bytes: fs.readFileSync(filename),
      }));
      const physicalProjectRule: Rule = {
        ...noAsyncEventHandlerWithoutReentryGuard,
        create: (context) => {
          if (context.filename === ownerFilename || context.filename === guardedFilename) {
            const code = context.sourceCode?.getText?.();
            if (code === undefined) throw new Error("Expected the current fuzz program source");
            fs.writeFileSync(context.filename, code);
            resetFilesystemCaches();
          }
          return noAsyncEventHandlerWithoutReentryGuard.create(context);
        },
      };
      try {
        const result = fuzzRuleWithStats(
          "no-async-event-handler-without-reentry-guard",
          physicalProjectRule,
          {
            iterations,
            seed,
            checkInvariants: true,
            corpus: [
              {
                relativePath: "unsafe-owned-hook-delivery.tsx",
                sourcePath: ownerFilename,
                code: source,
                ruleIds: ["no-async-event-handler-without-reentry-guard"],
                verdict: "fail",
              },
              {
                relativePath: "guarded-owned-hook-delivery.tsx",
                sourcePath: guardedFilename,
                code: guarded,
                ruleIds: ["no-async-event-handler-without-reentry-guard"],
                verdict: "pass",
              },
            ],
          },
        );
        expect(result.findings).toEqual([]);
        expect(result.stats.firedProgramCount).toBeGreaterThan(0);
      } finally {
        for (const owner of physicalOwners) fs.writeFileSync(owner.filename, owner.bytes);
        resetFilesystemCaches();
      }
      for (const owner of physicalOwners)
        expect(fs.readFileSync(owner.filename)).toEqual(owner.bytes);
    },
    timeoutMs,
  );
});
