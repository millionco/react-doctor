import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { checkSecurityScanCooperative } from "./check-security-scan.js";
import { SupplyChainOverlapTimeoutMs } from "./refs.js";
import type { ProjectChecks } from "./services/project-checks.js";
import type { SupplyChain } from "./services/supply-chain.js";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "./types/index.js";

interface StartBackgroundAnalyzerExecutionInput {
  readonly projectChecksService: ProjectChecks["Service"];
  readonly supplyChainService: SupplyChain["Service"];
  readonly rootDirectory: string;
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly isDiffMode: boolean;
  readonly shouldRunSupplyChain: boolean;
  readonly ignoredTags: ReadonlySet<string>;
  readonly includedTags: ReadonlySet<string> | undefined;
  readonly includeTagDefaults: boolean | undefined;
  readonly processDiagnostics: <StreamEnvironment>(
    stream: Stream.Stream<Diagnostic, never, StreamEnvironment>,
  ) => Stream.Stream<Diagnostic, never, StreamEnvironment>;
}

interface SupplyChainForkResult {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly timedOut: boolean;
}

interface BackgroundAnalyzerResult {
  readonly environmentDiagnostics: ReadonlyArray<Diagnostic>;
  readonly securityDiagnostics: ReadonlyArray<Diagnostic>;
  readonly supplyChainDiagnostics: ReadonlyArray<Diagnostic>;
  readonly securityScanFailed: boolean;
  readonly supplyChainOverlapTimedOut: boolean;
}

interface BackgroundAnalyzerExecution {
  readonly join: Effect.Effect<BackgroundAnalyzerResult>;
}

export const startBackgroundAnalyzerExecution = (
  input: StartBackgroundAnalyzerExecutionInput,
): Effect.Effect<BackgroundAnalyzerExecution> =>
  Effect.gen(function* () {
    const environmentDiagnostics = input.isDiffMode
      ? []
      : yield* input.projectChecksService.run({
          rootDirectory: input.rootDirectory,
          project: input.project,
        });
    const processedEnvironmentDiagnostics = yield* Stream.runCollect(
      input.processDiagnostics(Stream.fromIterable(environmentDiagnostics)),
    );

    const securityScanFailedRef = yield* Ref.make(false);
    const securityScanFiber = yield* Effect.forkChild(
      Stream.runCollect(
        input.processDiagnostics(
          input.isDiffMode
            ? Stream.empty
            : Stream.unwrap(
                Effect.tryPromise(() =>
                  checkSecurityScanCooperative(input.rootDirectory, {
                    project: input.project,
                    ignoredTags: input.ignoredTags,
                    includedTags: input.includedTags,
                    includeTagDefaults: input.includeTagDefaults,
                  }),
                ).pipe(
                  Effect.map(Stream.fromIterable),
                  Effect.catch(() =>
                    Ref.set(securityScanFailedRef, true).pipe(Effect.as(Stream.empty)),
                  ),
                ),
              ),
        ),
      ).pipe(Effect.withSpan("SecurityScan.run")),
    );

    const supplyChainOverlapTimeoutMs = yield* SupplyChainOverlapTimeoutMs;
    const supplyChainFiber = yield* Effect.forkChild(
      input.shouldRunSupplyChain
        ? Stream.runCollect(
            input.processDiagnostics(
              input.supplyChainService.run({
                rootDirectory: input.rootDirectory,
                userConfig: input.userConfig,
              }),
            ),
          ).pipe(
            Effect.map(
              (diagnostics): SupplyChainForkResult => ({
                diagnostics,
                timedOut: false,
              }),
            ),
            Effect.timeout(supplyChainOverlapTimeoutMs),
            Effect.orElseSucceed(
              (): SupplyChainForkResult => ({ diagnostics: [], timedOut: true }),
            ),
          )
        : Effect.succeed<SupplyChainForkResult>({
            diagnostics: [],
            timedOut: false,
          }),
    );

    return {
      join: Effect.gen(function* () {
        const supplyChainResult = yield* Fiber.join(supplyChainFiber);
        const securityDiagnostics = yield* Fiber.join(securityScanFiber);
        const securityScanFailed = yield* Ref.get(securityScanFailedRef);

        return {
          environmentDiagnostics: processedEnvironmentDiagnostics,
          securityDiagnostics,
          supplyChainDiagnostics: supplyChainResult.diagnostics,
          securityScanFailed,
          supplyChainOverlapTimedOut: supplyChainResult.timedOut,
        };
      }),
    };
  });
