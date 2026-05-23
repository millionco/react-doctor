import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  highlighter,
  NodeResolver,
  OXLINT_NODE_REQUIREMENT,
  OXLINT_RECOMMENDED_NODE_MAJOR,
} from "@react-doctor/core";
import { prompts } from "./prompts.js";

const consoleWarn = (message: string): Effect.Effect<void> =>
  Console.warn(highlighter.warn(message));
const consoleBreak: Effect.Effect<void> = Console.log("");
const consoleDim = (message: string): Effect.Effect<void> => Console.log(highlighter.gray(message));
const consoleSuccess = (message: string): Effect.Effect<void> =>
  Console.log(highlighter.success(message));

const promptShouldInstallNode = (): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    const { shouldInstallNode } = await prompts({
      type: "confirm",
      name: "shouldInstallNode",
      message: `Install Node ${OXLINT_RECOMMENDED_NODE_MAJOR} via nvm to enable lint checks?`,
      initial: true,
    });
    return Boolean(shouldInstallNode);
  });

const resolveOxlintNodeEffect = (
  isLintEnabled: boolean,
  isQuiet: boolean,
): Effect.Effect<string | null, never, NodeResolver> =>
  Effect.gen(function* () {
    if (!isLintEnabled) return null;
    const resolver = yield* NodeResolver;
    const initial = yield* resolver.resolve();

    if (initial !== null) {
      if (!initial.isCurrentNode && !isQuiet) {
        yield* consoleWarn(
          `Node ${process.version} is unsupported by oxlint. Using Node ${initial.version} from nvm.`,
        );
        yield* consoleBreak;
      }
      return initial.binaryPath;
    }

    if (isQuiet) return null;

    yield* consoleWarn(
      `Node ${process.version} is not compatible with oxlint (requires ${OXLINT_NODE_REQUIREMENT}). Lint checks will be skipped.`,
    );

    const isNvmInstalled = yield* resolver.isNvmInstalled();

    if (isNvmInstalled && process.stdin.isTTY) {
      const shouldInstall = yield* promptShouldInstallNode();

      if (shouldInstall) {
        yield* consoleBreak;
        const didInstall = yield* resolver.installViaNvm();
        const fresh = didInstall ? yield* resolver.resolve() : null;
        if (fresh) {
          yield* consoleBreak;
          yield* consoleSuccess(`Node ${fresh.version} installed. Using it for lint checks.`);
          yield* consoleBreak;
          return fresh.binaryPath;
        }
        yield* consoleBreak;
        yield* consoleWarn("Failed to install Node via nvm. Skipping lint checks.");
        yield* consoleBreak;
        return null;
      }
    } else if (isNvmInstalled) {
      yield* consoleDim(`  Run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`);
    } else {
      yield* consoleDim(
        `  Install nvm (https://github.com/nvm-sh/nvm) and run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`,
      );
    }

    yield* consoleBreak;
    return null;
  });

export const resolveOxlintNode = (
  isLintEnabled: boolean,
  isQuiet: boolean,
): Promise<string | null> =>
  Effect.runPromise(
    resolveOxlintNodeEffect(isLintEnabled, isQuiet).pipe(Effect.provide(NodeResolver.layerNode)),
  );
