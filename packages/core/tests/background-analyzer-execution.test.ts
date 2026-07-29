import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CheckSecurityScanOptions } from "../src/check-security-scan.js";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "../src/types/index.js";

const checkSecurityScanCooperativeMock = vi.hoisted(() =>
  vi.fn<(rootDirectory: string, options?: CheckSecurityScanOptions) => Promise<Diagnostic[]>>(),
);

vi.mock("../src/check-security-scan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/check-security-scan.js")>()),
  checkSecurityScanCooperative: checkSecurityScanCooperativeMock,
}));

import { startBackgroundAnalyzerExecution } from "../src/background-analyzer-execution.js";
import { SupplyChainOverlapTimeoutMs } from "../src/refs.js";
import { ProjectChecks } from "../src/services/project-checks.js";
import { SupplyChain } from "../src/services/supply-chain.js";

const ROOT_DIRECTORY = "/repo";
const LONG_TIMEOUT_MS = 60_000;
const SHORT_TIMEOUT_MS = 20;

const project = {
  rootDirectory: ROOT_DIRECTORY,
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
} satisfies ProjectInfo;

const environmentDiagnostic: Diagnostic = {
  filePath: "/repo/package.json",
  plugin: "react-doctor",
  rule: "environment-check",
  severity: "warning",
  message: "Environment finding",
  help: "Fix the environment.",
  line: 1,
  column: 1,
  category: "Maintainability",
};

const securityDiagnostic: Diagnostic = {
  ...environmentDiagnostic,
  filePath: "/repo/public/debug.log",
  rule: "security-check",
  message: "Security finding",
  category: "Security",
};

const supplyChainDiagnostic: Diagnostic = {
  ...environmentDiagnostic,
  rule: "supply-chain-check",
  message: "Supply-chain finding",
  category: "Security",
};

beforeEach(() => {
  checkSecurityScanCooperativeMock.mockReset();
  checkSecurityScanCooperativeMock.mockResolvedValue([]);
});

describe("startBackgroundAnalyzerExecution", () => {
  it("processes environment checks before starting both background analyzers and joins before finalization", async () => {
    const events: string[] = [];
    const ignoredTags = new Set(["experimental"]);
    const includedTags = new Set(["security"]);
    const userConfig: ReactDoctorConfig = {
      supplyChain: { enabled: true },
    };
    let resolveSecurityStart = (): void => undefined;
    let releaseSecurity = (): void => undefined;
    const securityStarted = new Promise<void>((resolve) => {
      resolveSecurityStart = resolve;
    });
    const securityReleased = new Promise<void>((resolve) => {
      releaseSecurity = resolve;
    });
    checkSecurityScanCooperativeMock.mockImplementation(async () => {
      events.push("security:start");
      resolveSecurityStart();
      await securityReleased;
      events.push("security:complete");
      return [securityDiagnostic];
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const supplyStarted = yield* Deferred.make<void>();
        const releaseSupply = yield* Deferred.make<void>();
        let receivedUserConfig: ReactDoctorConfig | null | undefined;
        const execution = yield* startBackgroundAnalyzerExecution({
          projectChecksService: ProjectChecks.of({
            run: () =>
              Effect.sync(() => {
                events.push("project-checks");
                return [environmentDiagnostic];
              }),
          }),
          supplyChainService: SupplyChain.of({
            run: (input) => {
              receivedUserConfig = input.userConfig;
              events.push("supply-chain:run");
              return Stream.fromEffect(
                Effect.gen(function* () {
                  events.push("supply-chain:start");
                  yield* Deferred.succeed(supplyStarted, undefined);
                  yield* Deferred.await(releaseSupply);
                  events.push("supply-chain:complete");
                  return supplyChainDiagnostic;
                }),
              );
            },
          }),
          rootDirectory: ROOT_DIRECTORY,
          project,
          userConfig,
          isDiffMode: false,
          shouldRunSupplyChain: true,
          ignoredTags,
          includedTags,
          includeTagDefaults: false,
          processDiagnostics: (stream) =>
            stream.pipe(
              Stream.tap((diagnostic) =>
                Effect.sync(() => {
                  events.push(`reporter:${diagnostic.rule}`);
                }),
              ),
            ),
        });

        yield* Effect.promise(() => securityStarted);
        yield* Deferred.await(supplyStarted);
        events.push("lint:checkpoint");
        releaseSecurity();
        yield* Deferred.succeed(releaseSupply, undefined);
        const result = yield* execution.join;
        events.push("reporter:finalize");
        return { result, receivedUserConfig };
      }).pipe(Effect.provideService(SupplyChainOverlapTimeoutMs, LONG_TIMEOUT_MS)),
    );

    expect(checkSecurityScanCooperativeMock).toHaveBeenCalledWith(
      ROOT_DIRECTORY,
      expect.objectContaining({
        project,
        ignoredTags,
        includedTags,
        includeTagDefaults: false,
      }),
    );
    expect(result.receivedUserConfig).toBe(userConfig);
    expect(result.result).toEqual({
      environmentDiagnostics: [environmentDiagnostic],
      securityDiagnostics: [securityDiagnostic],
      supplyChainDiagnostics: [supplyChainDiagnostic],
      securityScanFailed: false,
      supplyChainOverlapTimedOut: false,
    });
    expect(events.slice(0, 2)).toEqual(["project-checks", "reporter:environment-check"]);
    expect(events.indexOf("security:start")).toBeLessThan(events.indexOf("lint:checkpoint"));
    expect(events.indexOf("supply-chain:start")).toBeLessThan(events.indexOf("lint:checkpoint"));
    expect(events.at(-1)).toBe("reporter:finalize");
    expect(events.indexOf("reporter:security-check")).toBeLessThan(
      events.indexOf("reporter:finalize"),
    );
    expect(events.indexOf("reporter:supply-chain-check")).toBeLessThan(
      events.indexOf("reporter:finalize"),
    );
  });

  it("keeps project, security, and supply-chain analyzers idle when their gates are closed", async () => {
    let projectCheckRunCount = 0;
    let supplyChainRunCount = 0;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* startBackgroundAnalyzerExecution({
          projectChecksService: ProjectChecks.of({
            run: () => {
              projectCheckRunCount += 1;
              return Effect.succeed([environmentDiagnostic]);
            },
          }),
          supplyChainService: SupplyChain.of({
            run: () => {
              supplyChainRunCount += 1;
              return Stream.make(supplyChainDiagnostic);
            },
          }),
          rootDirectory: ROOT_DIRECTORY,
          project,
          userConfig: null,
          isDiffMode: true,
          shouldRunSupplyChain: false,
          ignoredTags: new Set(),
          includedTags: undefined,
          includeTagDefaults: undefined,
          processDiagnostics: (stream) => stream,
        });
        return yield* execution.join;
      }),
    );

    expect(projectCheckRunCount).toBe(0);
    expect(supplyChainRunCount).toBe(0);
    expect(checkSecurityScanCooperativeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      environmentDiagnostics: [],
      securityDiagnostics: [],
      supplyChainDiagnostics: [],
      securityScanFailed: false,
      supplyChainOverlapTimedOut: false,
    });
  });

  it("fails an escaping security-scan rejection open and records its telemetry flag", async () => {
    const events: string[] = [];
    let resolveSecurityFailure = (): void => undefined;
    const securityFailed = new Promise<void>((resolve) => {
      resolveSecurityFailure = resolve;
    });
    checkSecurityScanCooperativeMock.mockImplementation(async () => {
      events.push("security:failed");
      resolveSecurityFailure();
      throw new Error("EMFILE: too many open files");
    });

    const { eventsBeforeSupplyRelease, result } = await Effect.runPromise(
      Effect.gen(function* () {
        const supplyStarted = yield* Deferred.make<void>();
        const releaseSupply = yield* Deferred.make<void>();
        const execution = yield* startBackgroundAnalyzerExecution({
          projectChecksService: ProjectChecks.of({
            run: () => Effect.succeed([]),
          }),
          supplyChainService: SupplyChain.of({
            run: () =>
              Stream.fromEffect(
                Effect.gen(function* () {
                  events.push("supply-chain:start");
                  yield* Deferred.succeed(supplyStarted, undefined);
                  yield* Deferred.await(releaseSupply);
                  events.push("supply-chain:complete");
                  return supplyChainDiagnostic;
                }),
              ),
          }),
          rootDirectory: ROOT_DIRECTORY,
          project,
          userConfig: null,
          isDiffMode: false,
          shouldRunSupplyChain: true,
          ignoredTags: new Set(),
          includedTags: undefined,
          includeTagDefaults: undefined,
          processDiagnostics: (stream) => stream,
        });
        yield* Effect.promise(() => securityFailed);
        yield* Deferred.await(supplyStarted);
        const joinFiber = yield* Effect.forkChild(
          execution.join.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                events.push("join:complete");
              }),
            ),
          ),
        );
        yield* Effect.yieldNow;
        const eventsBeforeSupplyRelease = [...events];
        yield* Deferred.succeed(releaseSupply, undefined);
        const result = yield* Fiber.join(joinFiber);
        return { eventsBeforeSupplyRelease, result };
      }).pipe(Effect.provideService(SupplyChainOverlapTimeoutMs, LONG_TIMEOUT_MS)),
    );

    expect(eventsBeforeSupplyRelease).not.toContain("join:complete");
    expect(events).toEqual([
      "security:failed",
      "supply-chain:start",
      "supply-chain:complete",
      "join:complete",
    ]);
    expect(result.securityDiagnostics).toEqual([]);
    expect(result.securityScanFailed).toBe(true);
    expect(result.supplyChainOverlapTimedOut).toBe(false);
  });

  it("measures the supply-chain timeout from the pre-lint fork and fails open", async () => {
    const events: string[] = [];
    let resolveSecurityStart = (): void => undefined;
    let releaseSecurity = (): void => undefined;
    const securityStarted = new Promise<void>((resolve) => {
      resolveSecurityStart = resolve;
    });
    const securityReleased = new Promise<void>((resolve) => {
      releaseSecurity = resolve;
    });
    checkSecurityScanCooperativeMock.mockImplementation(async () => {
      events.push("security:start");
      resolveSecurityStart();
      await securityReleased;
      events.push("security:complete");
      return [];
    });

    const { eventsBeforeSecurityRelease, result } = await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* startBackgroundAnalyzerExecution({
          projectChecksService: ProjectChecks.of({
            run: () => Effect.succeed([]),
          }),
          supplyChainService: SupplyChain.of({
            run: () => Stream.never,
          }),
          rootDirectory: ROOT_DIRECTORY,
          project,
          userConfig: null,
          isDiffMode: false,
          shouldRunSupplyChain: true,
          ignoredTags: new Set(),
          includedTags: undefined,
          includeTagDefaults: undefined,
          processDiagnostics: (stream) => stream,
        });
        yield* Effect.promise(() => securityStarted);
        yield* Effect.sleep("40 millis");
        const joinFiber = yield* Effect.forkChild(
          execution.join.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                events.push("join:complete");
              }),
            ),
          ),
        );
        yield* Effect.yieldNow;
        const eventsBeforeSecurityRelease = [...events];
        releaseSecurity();
        const result = yield* Fiber.join(joinFiber);
        return { eventsBeforeSecurityRelease, result };
      }).pipe(Effect.provideService(SupplyChainOverlapTimeoutMs, SHORT_TIMEOUT_MS)),
    );

    expect(eventsBeforeSecurityRelease).toEqual(["security:start"]);
    expect(events).toEqual(["security:start", "security:complete", "join:complete"]);
    expect(result.supplyChainDiagnostics).toEqual([]);
    expect(result.supplyChainOverlapTimedOut).toBe(true);
    expect(result.securityScanFailed).toBe(false);
  });
});
