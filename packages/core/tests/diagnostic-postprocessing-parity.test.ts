import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticPipeline } from "../src/build-diagnostic-pipeline.js";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "../src/types/index.js";
import { runInspect, type InspectInput } from "../src/run-inspect.js";
import { DeadCodeOverlap } from "../src/refs.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { Git } from "../src/services/git.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Progress } from "../src/services/progress.js";
import { Project } from "../src/services/project.js";
import { ProjectChecks } from "../src/services/project-checks.js";
import { Reporter, ReporterCapture } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";
import { SupplyChain } from "../src/services/supply-chain.js";
import { dedupeDiagnostics } from "../src/utils/dedupe-diagnostics.js";

const project: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "postprocessing-parity",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  tanstackQueryVersion: null,
  valtioVersion: null,
  valtioMajorVersion: null,
  hasSsrDependency: false,
  preactVersion: null,
  preactMajorVersion: null,
  hasReactNativeWorkspace: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  reanimatedVersion: null,
  isPreES2023Target: false,
  isStaticExport: false,
  sourceFileCount: 8,
};

const input: InspectInput = {
  directory: "/repo",
  includePaths: ["src/exact.tsx"],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  runDeadCode: false,
  warnings: true,
  isCi: false,
};

const userConfig: ReactDoctorConfig = {
  rules: {
    "react-doctor/suppressed-config": "off",
    "react-doctor/no-derived-state": "error",
    "react-doctor/restamped": "error",
  },
  ignore: {
    overrides: [
      {
        files: ["src/override.tsx"],
        rules: ["react-doctor/suppressed-override"],
      },
    ],
  },
  surfaces: {
    score: {
      excludeRules: ["react-doctor/score-hidden"],
    },
  },
};

const buildDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/exact.tsx",
  plugin: "react-doctor",
  rule: "exact",
  severity: "warning",
  message: "Exact finding",
  help: "Fix the finding.",
  line: 1,
  column: 1,
  category: "Maintainability",
  ...overrides,
});

const exactDiagnostic = buildDiagnostic({});
const exactDuplicate = buildDiagnostic({ help: "A duplicate with different derived help." });
const configSuppressedFirst = buildDiagnostic({
  filePath: "src/config.tsx",
  rule: "suppressed-config",
  message: "Config-suppressed finding",
});
const configSuppressedSecond = buildDiagnostic({
  ...configSuppressedFirst,
  line: 2,
});
const overrideSuppressed = buildDiagnostic({
  filePath: "src/override.tsx",
  rule: "suppressed-override",
  message: "Override-suppressed finding",
});
const inlineSuppressed = buildDiagnostic({
  filePath: "src/inline.tsx",
  rule: "suppressed-inline",
  message: "Inline-suppressed finding",
  line: 2,
});
const relatedFallback = buildDiagnostic({
  filePath: "src/related.tsx",
  rule: "no-derived-state",
  message: "Derived state write",
  offset: 100,
  length: 12,
  line: 12,
  column: 3,
});
const relatedPreferred = buildDiagnostic({
  ...relatedFallback,
  rule: "no-adjust-state-on-prop-change",
});
const restampedWarning = buildDiagnostic({
  filePath: "src/restamped.tsx",
  rule: "restamped",
  message: "Severity-restamped finding",
  line: 7,
  column: 4,
});
const restampedError = buildDiagnostic({
  ...restampedWarning,
  severity: "error",
});
const groupedLater = buildDiagnostic({
  filePath: "src/group.tsx",
  rule: "no-derived-state-effect",
  message: "State resets after every prop change.",
  line: 30,
});
const groupedEarlier = buildDiagnostic({
  ...groupedLater,
  line: 20,
});
const scoreHidden = buildDiagnostic({
  filePath: "src/a-score-hidden.tsx",
  rule: "score-hidden",
  message: "Visible outside the score.",
  line: 5,
});

const rawDiagnostics = [
  exactDiagnostic,
  exactDuplicate,
  configSuppressedFirst,
  configSuppressedSecond,
  overrideSuppressed,
  inlineSuppressed,
  relatedFallback,
  relatedPreferred,
  restampedWarning,
  restampedError,
  groupedLater,
  groupedEarlier,
  scoreHidden,
];

const backendDiagnostics = dedupeDiagnostics(rawDiagnostics);
const relatedWinner = { ...relatedPreferred, severity: "error" };
const restampedDuplicate = { ...restampedWarning, severity: "error" };
const fixGroupId = "f88ca5c4b658d46a";
const groupedEarlierFinal = { ...groupedEarlier, fixGroupId };
const groupedLaterFinal = { ...groupedLater, fixGroupId };

const expectedReporterDiagnostics = [
  exactDiagnostic,
  relatedWinner,
  restampedDuplicate,
  restampedDuplicate,
  groupedLater,
  groupedEarlier,
  scoreHidden,
];

const expectedFinalDiagnostics = [
  scoreHidden,
  exactDiagnostic,
  groupedEarlierFinal,
  groupedLaterFinal,
  relatedWinner,
  restampedDuplicate,
  restampedDuplicate,
];

describe("diagnostic post-processing parity", () => {
  it("freezes backend acceptance through reporter, score, and final output boundaries", async () => {
    expect(backendDiagnostics).toEqual([
      exactDiagnostic,
      configSuppressedFirst,
      configSuppressedSecond,
      overrideSuppressed,
      inlineSuppressed,
      relatedFallback,
      relatedPreferred,
      restampedWarning,
      restampedError,
      groupedLater,
      groupedEarlier,
      scoreHidden,
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scoreDiagnosticsRef = yield* Ref.make<ReadonlyArray<Diagnostic>>([]);
        const scoreLayer = Layer.succeed(
          Score,
          Score.of({
            compute: (scoreInput) =>
              Ref.set(scoreDiagnosticsRef, scoreInput.diagnostics).pipe(
                Effect.as({ score: 85, label: "Good" }),
              ),
          }),
        );
        const layers = Layer.mergeAll(
          Project.layerOf(project),
          ProjectChecks.layerOf([]),
          Config.layerOf({
            config: userConfig,
            resolvedDirectory: "/repo",
            configSourceDirectory: null,
          }),
          Files.layerInMemory(
            new Map([
              [
                "/repo/src/inline.tsx",
                "// react-doctor-disable-next-line react-doctor/suppressed-inline\nconst value = 1;\n",
              ],
            ]),
          ),
          Linter.layerOf(backendDiagnostics),
          LintPartialFailures.layerLive,
          DeadCode.layerOf([]),
          Git.layerOf({
            headSha: "abc123",
            githubRepo: "millionco/postprocessing-parity",
            defaultBranch: "main",
          }),
          scoreLayer,
          SupplyChain.layerOf([]),
          Progress.layerNoop,
          Reporter.layerCapture,
          Layer.succeed(DeadCodeOverlap, "off"),
        );

        return yield* Effect.gen(function* () {
          const output = yield* runInspect(input);
          const reporterCapture = yield* ReporterCapture;
          return {
            output,
            reporterDiagnostics: yield* Ref.get(reporterCapture),
            scoreDiagnostics: yield* Ref.get(scoreDiagnosticsRef),
          };
        }).pipe(Effect.provide(layers));
      }),
    );

    expect(result.reporterDiagnostics).toEqual(expectedReporterDiagnostics);
    expect(result.reporterDiagnostics.every((diagnostic) => !("fixGroupId" in diagnostic))).toBe(
      true,
    );
    expect(result.output.diagnostics).toEqual(expectedFinalDiagnostics);
    expect(result.scoreDiagnostics).toEqual(
      expectedFinalDiagnostics.filter((diagnostic) => diagnostic.rule !== "score-hidden"),
    );
    expect(result.output.suppressedRuleCounts).toEqual([
      { rule: "react-doctor/suppressed-config", source: "config", count: 2 },
      { rule: "react-doctor/suppressed-override", source: "override", count: 1 },
      { rule: "react-doctor/suppressed-inline", source: "inline", count: 1 },
    ]);
  });

  it("orders suppression summaries by first-observed rule and source", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig,
      readFileLinesSync: (filePath) =>
        filePath === "/repo/src/inline.tsx"
          ? ["// react-doctor-disable-next-line react-doctor/suppressed-inline", "const value = 1;"]
          : null,
      respectInlineDisables: true,
      showWarnings: true,
    });

    for (const diagnostic of [
      inlineSuppressed,
      overrideSuppressed,
      configSuppressedFirst,
      configSuppressedSecond,
    ]) {
      expect(pipeline.apply(diagnostic)).toBeNull();
    }

    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-doctor/suppressed-inline", source: "inline", count: 1 },
      { rule: "react-doctor/suppressed-override", source: "override", count: 1 },
      { rule: "react-doctor/suppressed-config", source: "config", count: 2 },
    ]);
  });
});
