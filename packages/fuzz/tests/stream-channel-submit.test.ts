import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";
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

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-stream-channel-"));
const unsafeDirectory = path.join(directory, "unsafe");
const guardedDirectory = path.join(directory, "guarded");
const ownerFilename = path.join(unsafeDirectory, "editor.tsx");
const guardedFilename = path.join(guardedDirectory, "editor.tsx");
const fixtureFiles = [
  "package.json",
  "tsconfig.json",
  "application.tsx",
  "workspace.tsx",
  "editor.tsx",
  "picker.tsx",
];
const source = fs.readFileSync(
  new URL("../fixtures/stream-channel-submit/editor.tsx.txt", import.meta.url),
  "utf8",
);
const guarded = source
  .replace("import { useState }", "import { useRef, useState }")
  .replace(
    "  const selected = channel;",
    "  const selected = channel;\n  const pending = useRef(false);",
  )
  .replace(
    "  const save = async () => {",
    "  const save = async () => {\n    if (pending.current) return;\n    pending.current = true;",
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
        fs.readFileSync(
          new URL(`../fixtures/stream-channel-submit/${basename}.txt`, import.meta.url),
        ),
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

describe("Stream channel mutation project fuzzing", () => {
  it("reports the selected channel mutation after query and provider publication", () => {
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, source, {
      filename: ownerFilename,
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const offset = source.indexOf("await selected.update");
    expect(offset).toBeGreaterThan(0);
    expect(result.diagnostics[0].line).toBe(source.slice(0, offset).split("\n").length);
    for (const basename of ["application.tsx", "workspace.tsx", "picker.tsx"]) {
      const filename = path.join(unsafeDirectory, basename);
      const other = runRule(
        noAsyncEventHandlerWithoutReentryGuard,
        fs.readFileSync(filename, "utf8"),
        {
          filename,
        },
      );
      expect(other.parseErrors).toEqual([]);
      expect(other.diagnostics).toEqual([]);
    }
  });

  it("keeps the same owned mutation quiet behind a leading ref guard", () => {
    expect(guarded).not.toBe(source);
    expect(guarded).toContain("if (pending.current) return;");
    expect(guarded).toContain("pending.current = true;");
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, guarded, {
      filename: guardedFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a different declared SDK version",
      basename: "package.json",
      before: '"stream-chat": "4.1.0"',
      after: '"stream-chat": "5.0.0"',
    },
    {
      name: "an editor outside the canonical provider",
      basename: "application.tsx",
      before: "  <Chat client={connection}>\n    <Workspace />\n  </Chat>",
      after: "  <>\n    <Chat client={connection}><span /></Chat>\n    <Workspace />\n  </>",
    },
    {
      name: "a non-channel published from the query state",
      basename: "picker.tsx",
      before: "      setChannels(available);",
      after: "      setChannels([{ update: async () => {} }]);",
    },
  ])("declines $name", ({ basename, before, after }) => {
    const filename = path.join(unsafeDirectory, basename);
    const original = fs.readFileSync(filename, "utf8");
    const changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    fs.writeFileSync(filename, changed);
    resetFilesystemCaches();
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, source, {
      filename: ownerFilename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("replays a channel capability consumer and a firing inverse", () => {
    const regressionFilename = fs.realpathSync(
      new URL(
        "../corpus/regressions/no-async-event-handler-without-reentry-guard--channel-capability-escape/editor.tsx",
        import.meta.url,
      ),
    );
    const regressionSource = fs.readFileSync(regressionFilename, "utf8");
    expect(regressionSource).toContain("replaceMutation(channel);");
    expect(regressionSource).toContain("target.update = async () => {};");
    const result = fuzzRuleWithStats(
      "no-async-event-handler-without-reentry-guard",
      noAsyncEventHandlerWithoutReentryGuard,
      {
        iterations: 0,
        corpus: [
          {
            relativePath: "channel-capability-escape-editor.tsx",
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
      "  const replaceMutation = (target) => {\n    target.update = async () => {};\n  };\n  replaceMutation(channel);\n",
      "",
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
    "fuzzes firing and guarded physical channel editors",
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
                relativePath: "unsafe-stream-channel-editor.tsx",
                sourcePath: ownerFilename,
                code: source,
                ruleIds: ["no-async-event-handler-without-reentry-guard"],
                verdict: "fail",
              },
              {
                relativePath: "guarded-stream-channel-editor.tsx",
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
