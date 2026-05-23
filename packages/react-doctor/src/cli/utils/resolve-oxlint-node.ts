import * as Effect from "effect/Effect";
import {
  logger,
  NodeResolver,
  OXLINT_NODE_REQUIREMENT,
  OXLINT_RECOMMENDED_NODE_MAJOR,
} from "@react-doctor/core";
import { prompts } from "./prompts.js";

export const resolveOxlintNode = async (
  isLintEnabled: boolean,
  isQuiet: boolean,
): Promise<string | null> => {
  if (!isLintEnabled) return null;

  const runWithResolver = <Value>(
    program: Effect.Effect<Value, never, NodeResolver>,
  ): Promise<Value> => Effect.runPromise(program.pipe(Effect.provide(NodeResolver.layerNode)));

  const initial = await runWithResolver(
    Effect.gen(function* () {
      const resolver = yield* NodeResolver;
      return yield* resolver.resolve();
    }),
  );

  if (initial !== null) {
    if (!initial.isCurrentNode && !isQuiet) {
      logger.warn(
        `Node ${process.version} is unsupported by oxlint. Using Node ${initial.version} from nvm.`,
      );
      logger.break();
    }
    return initial.binaryPath;
  }

  if (isQuiet) return null;

  logger.warn(
    `Node ${process.version} is not compatible with oxlint (requires ${OXLINT_NODE_REQUIREMENT}). Lint checks will be skipped.`,
  );

  const isNvmInstalled = await runWithResolver(
    Effect.gen(function* () {
      const resolver = yield* NodeResolver;
      return yield* resolver.isNvmInstalled();
    }),
  );

  if (isNvmInstalled && process.stdin.isTTY) {
    const { shouldInstallNode } = await prompts({
      type: "confirm",
      name: "shouldInstallNode",
      message: `Install Node ${OXLINT_RECOMMENDED_NODE_MAJOR} via nvm to enable lint checks?`,
      initial: true,
    });

    if (shouldInstallNode) {
      logger.break();
      const fresh = await runWithResolver(
        Effect.gen(function* () {
          const resolver = yield* NodeResolver;
          const didInstall = yield* resolver.installViaNvm();
          return didInstall ? yield* resolver.resolve() : null;
        }),
      );
      if (fresh) {
        logger.break();
        logger.success(`Node ${fresh.version} installed. Using it for lint checks.`);
        logger.break();
        return fresh.binaryPath;
      }
      logger.break();
      logger.warn("Failed to install Node via nvm. Skipping lint checks.");
      logger.break();
      return null;
    }
  } else if (isNvmInstalled) {
    logger.dim(`  Run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`);
  } else {
    logger.dim(
      `  Install nvm (https://github.com/nvm-sh/nvm) and run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`,
    );
  }

  logger.break();
  return null;
};
